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
  correctionId?: string; 
}

const CACHE_KEY = 'spellCheckResultCache';

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

// In src/code.ts

async function collectTextNodesData(): Promise<{ selectionId: string; textData: TextNodeData[] }> {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.ui.postMessage({ type: "no-selection" });
    return { selectionId: '', textData: [] };
  }

  // Create a unique "fingerprint" for the current selection.
  const selectionId = selection.map(node => node.id).sort().join(',');

  let textNodes: readonly TextNode[] = [];
  selection.forEach(node => {
    if (node.type === "FRAME" || node.type === "GROUP" || node.type === "SECTION" || node.type === "COMPONENT" || node.type === "INSTANCE") {
      textNodes = textNodes.concat(node.findAllWithCriteria({ types: ["TEXT"] }));
    } else if (node.type === "TEXT") {
      textNodes = textNodes.concat([node]);
    }
  });

  if (textNodes.length === 0) {
      figma.notify("No text layers found in your selection.");
      return { selectionId, textData: [] };
  }

  const textData = textNodes.map((node) => ({
    id: node.id,
    text: node.characters,
  }));
  
  return { selectionId, textData };
}

async function handleRunCheck(checkType: 'TYPO_BRAND' | 'UX_WRITING'): Promise<void> {
  navigationState = {};

   figma.ui.postMessage({ type: "extraction-started", payload: { checkType } });
  const { selectionId, textData } = await collectTextNodesData();

  

  if (textData.length > 0) {
    // Check clientStorage for cached results
    const cache = await figma.clientStorage.getAsync(CACHE_KEY) || {};
    const cacheId = `${selectionId}-${checkType}`;
    
    if (cache[cacheId]) {
      console.log("Cache HIT. Sending stored results to UI.");
      // If we find results, send them directly to the UI
      figma.ui.postMessage({ type: "cached-results-found", payload: { corrections: cache[cacheId], checkType } });
    } else {
      console.log("Cache MISS. Proceeding with API check.");
      // If no results, tell the UI to make the API call
      figma.ui.postMessage({ type: "text-to-check", payload: { selectionId, textData, checkType } });
    }
  }
}

// Function to save new results to the cache
async function handleSaveResultsToCache(payload: { selectionId: string; checkType: string; corrections: any[] }): Promise<void> {
    const { selectionId, checkType, corrections } = payload;
    const cache = await figma.clientStorage.getAsync(CACHE_KEY) || {};
    const cacheId = `${selectionId}-${checkType}`;
    
    cache[cacheId] = corrections;
    
    await figma.clientStorage.setAsync(CACHE_KEY, cache);
    console.log(`Saved results for ${cacheId} to client storage.`);
}
// Smart navigation to word instances with cycling
async function handleNavigateToWord(payload: NavigateToWordPayload): Promise<void> {
  const { word, nodeIds, correctionId } = payload;
  
  // If nodeIds provided, initialize navigation state
  if (nodeIds && nodeIds.length > 0) {
    navigationState[word] = { nodeIds, currentIndex: 0 };
  }
  
  // Get current navigation state
  const navState = navigationState[word];
  if (!navState || !navState.nodeIds || navState.nodeIds.length === 0) return;

  await navigateToCurrentInstance(word, navState, correctionId);
}

// Navigate to previous instance
async function handleNavigatePrev(payload: NavigateToWordPayload): Promise<void> {
  const { word,  correctionId} = payload;
  const navState = navigationState[word];
  
  if (!navState || !navState.nodeIds || navState.nodeIds.length === 0) return;

  // Move to previous instance (wrap around)
  navState.currentIndex = navState.currentIndex <= 0 
    ? navState.nodeIds.length - 1 
    : navState.currentIndex - 1;

  await navigateToCurrentInstance(word, navState, correctionId);
}

// Navigate to next instance
async function handleNavigateNext(payload: NavigateToWordPayload): Promise<void> {
  const { word, correctionId } = payload;
  const navState = navigationState[word];
  
  if (!navState || !navState.nodeIds || navState.nodeIds.length === 0) return;

  // Move to next instance 
  navState.currentIndex = (navState.currentIndex + 1) % navState.nodeIds.length;

  await navigateToCurrentInstance(word, navState, correctionId);
}

// Core navigation function 
async function navigateToCurrentInstance(word: string, navState: { nodeIds: string[], currentIndex: number }, correctionId?: string): Promise<void> {
  const currentNodeId = navState.nodeIds[navState.currentIndex];

  try {
    const node = await figma.getNodeByIdAsync(currentNodeId);
    if (node && !node.removed && "absoluteBoundingBox" in node && node.absoluteBoundingBox) {
      // Select and navigate to the current instance
      if (node.parent) {
        figma.currentPage.selection = [node as SceneNode];
        figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
        
      
        figma.ui.postMessage({ 
          type: "navigation-update", 
          payload: { 
            word, 
            currentIndex: navState.currentIndex,  
            totalInstances: navState.nodeIds.length,
            correctionId: correctionId || '' 
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
      case "run-check":
        await handleRunCheck(msg.payload.checkType);
        break;

      case "save-results-to-cache":
        await handleSaveResultsToCache(msg.payload);
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