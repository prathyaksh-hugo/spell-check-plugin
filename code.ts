const HIGHLIGHT_GROUP_NAME = "SPELL CHECK HIGHLIGHTS";
let isPluginMakingChange = false;
let navigationState: { [word: string]: { nodeIds: string[], currentIndex: number } } = {};

// Add notification debouncing
let notificationTimeout: ReturnType<typeof setTimeout> | null = null;

interface TextNodeData {
  id: string;
  text: string;
}

interface ReplaceWordPayload {
  nodeIds: string[];
  oldWord: string;
  newWord: string;
}

interface NavigateToWordPayload {
  word: string;
  nodeIds?: string[];
}

// // Debounced notification function
function showDebouncedNotification(message: string, delay: number = 500): void {
  // Cancel any existing notification timeout
  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
  }
  
  // Set new timeout for notification
  notificationTimeout = setTimeout(() => {
    figma.notify(message);
    notificationTimeout = null;
  }, delay);
}

// Clear navigation state
function clearNavigationState(): void {
  navigationState = {};
  // Clear any pending notifications
  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
    notificationTimeout = null;
  }
}

// Collect all text nodes from current page 
async function collectTextNodesData(): Promise<TextNodeData[]> {
  const textNodes = figma.currentPage.findAllWithCriteria({ types: ["TEXT"] });
  return textNodes.map((node) => ({
    id: node.id,
    text: node.characters,
  }));
}

// Handle spell check initiation
async function handleSpellCheck(): Promise<void> {
  clearNavigationState();
  const allTextData = await collectTextNodesData();
  figma.ui.postMessage({ type: "text-to-check", payload: allTextData });
}

// Smart navigation to word instances with cycling
async function handleNavigateToWord(payload: NavigateToWordPayload): Promise<void> {
  const { word, nodeIds } = payload;
  
  // If nodeIds provided, initialize navigation state
  if (nodeIds && nodeIds.length > 0) {
    navigationState[word] = { nodeIds, currentIndex: 0 };
  }
  
  // Get current navigation state
  const navState = navigationState[word];
  if (!navState || !navState.nodeIds || navState.nodeIds.length === 0) return;

  await navigateToCurrentInstance(word, navState);
}

// Navigate to previous instance
async function handleNavigatePrev(payload: NavigateToWordPayload): Promise<void> {
  const { word } = payload;
  const navState = navigationState[word];
  
  if (!navState || !navState.nodeIds || navState.nodeIds.length === 0) return;

  // Move to previous instance (wrap around)
  navState.currentIndex = navState.currentIndex <= 0 
    ? navState.nodeIds.length - 1 
    : navState.currentIndex - 1;

  await navigateToCurrentInstance(word, navState);
}

// Navigate to next instance
async function handleNavigateNext(payload: NavigateToWordPayload): Promise<void> {
  const { word } = payload;
  const navState = navigationState[word];
  
  if (!navState || !navState.nodeIds || navState.nodeIds.length === 0) return;

  // Move to next instance 
  navState.currentIndex = (navState.currentIndex + 1) % navState.nodeIds.length;

  await navigateToCurrentInstance(word, navState);
}

// Core navigation function 
async function navigateToCurrentInstance(word: string, navState: { nodeIds: string[], currentIndex: number }): Promise<void> {
  const currentNodeId = navState.nodeIds[navState.currentIndex];

  try {
    const node = await figma.getNodeByIdAsync(currentNodeId);
    if (node && !node.removed && "absoluteBoundingBox" in node && node.absoluteBoundingBox) {
      // Select and navigate to the current instance
      if (node.parent) {
        figma.currentPage.selection = [node as SceneNode];
        figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
        
        // Update UI with current position (immediate)
        figma.ui.postMessage({ 
          type: "navigation-update", 
          payload: { 
            word, 
            currentIndex: navState.currentIndex + 1, 
            totalInstances: navState.nodeIds.length 
          }
        });

        // Use debounced notification to prevent lag
        const instanceText = navState.nodeIds.length > 1 
          ? ` (${navState.currentIndex + 1}/${navState.nodeIds.length})` 
          : '';
        
        showDebouncedNotification(`" Navigated to ${word}"${instanceText}`, 300);
      
      }
    }
  } catch (error) {
    console.error(`Error navigating to node ${currentNodeId}:`, error);
    // Use immediate notification for errors
    figma.notify(`Could not navigate to "${word}". Node may have been deleted.`);
  }
}

// Handle word replacement in text nodes 
async function handleReplaceWord(payload: ReplaceWordPayload): Promise<void> {
  const { nodeIds, oldWord, newWord } = payload;
  let replacedCount = 0;

  // Clear navigation state for replaced word
  delete navigationState[oldWord];

  for (const id of nodeIds) {
    try {
      const node = await figma.getNodeByIdAsync(id);
      if (node && node.type === "TEXT") {
        const font = node.fontName as FontName;
        await figma.loadFontAsync(font);
        isPluginMakingChange = true;

        const beforeText = node.characters;
        const afterText = beforeText.replace(new RegExp(`\\b${oldWord}\\b`, "gi"), newWord);
        if (beforeText !== afterText) {
          node.characters = afterText;
          replacedCount++;
        }
      }
    } catch (error) {
      console.error(`Error replacing word in node ${id}:`, error);
    }
  }

  figma.ui.postMessage({ type: "word-replaced", word: oldWord });
  // Immediate notification for replacements
  figma.notify(
    `Replaced "${oldWord}" with "${newWord}" in ${replacedCount} text layer${
      replacedCount !== 1 ? "s" : ""
    }.`
  );
}

// Handle window resize requests
function handleResize(width?: number, height?: number): void {
  if (width && height) {
    figma.ui.resize(width, height);
  }
}

// Event listeners with improved change detection
function setupEventListeners(): void {
  figma.on("close", () => {
    clearNavigationState();
  });

  // Improved document change detection
  figma.on("documentchange", () => {
    if (isPluginMakingChange) {
      isPluginMakingChange = false;
      return;
    }
    
    // Only trigger re-check for meaningful changes
    figma.ui.postMessage({ type: "re-check-document" });
  });
}

// Initialize plugin
async function main(): Promise<void> {
  await figma.loadAllPagesAsync();
  figma.showUI(__html__, { width: 450, height: 550 });

  setupEventListeners();

  figma.ui.onmessage = async (msg) => {
    switch (msg.type) {
      case "spell-check":
        await handleSpellCheck();
        break;

      case "navigate-to-word":
        await handleNavigateToWord(msg.payload);
        break;

      case "navigate-prev":
        await handleNavigatePrev(msg.payload);
        break;

      case "navigate-next":
        await handleNavigateNext(msg.payload);
        break;

      case "replace-word":
        await handleReplaceWord(msg.payload);
        break;

      case "resize-window":
        handleResize(msg.width, msg.height);
        break;

      case "clear-navigation":
        clearNavigationState();
        break;

      default:
        console.warn(`Unhandled message type: ${msg.type}`);
        break;
    }
  };
}

main();
