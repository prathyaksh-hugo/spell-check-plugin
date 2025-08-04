const HIGHLIGHT_GROUP_NAME = "SPELL CHECK HIGHLIGHTS";
let isPluginMakingChange = false;

interface TextNodeData {
  id: string;
  text: string;
}

interface ReplaceWordPayload {
  nodeIds: string[];
  oldWord: string;
  newWord: string;
}

// Clear previous highlight rectangles from the canvas
function clearOldHighlights(): void {
  try {
    const oldHighlightGroup = figma.currentPage.findOne(
      (node) => node.name === HIGHLIGHT_GROUP_NAME
    );
    if (oldHighlightGroup) {
      isPluginMakingChange = true;
      oldHighlightGroup.remove();
    }
  } catch (error) {
    console.error("Error clearing old highlights:", error);
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
  clearOldHighlights();
  const allTextData = await collectTextNodesData();
  figma.ui.postMessage({ type: "text-to-check", payload: allTextData });
}

// Create highlight rectangles around specified nodes
async function createHighlightRectangles(nodeIds: string[]): Promise<{
  highlightLayers: RectangleNode[];
  nodesToSelect: SceneNode[];
}> {
  const highlightLayers: RectangleNode[] = [];
  const nodesToSelect: SceneNode[] = [];

  for (const id of nodeIds) {
    try {
      const node = await figma.getNodeByIdAsync(id);
      if (
        node &&
        !node.removed &&
        "absoluteBoundingBox" in node &&
        node.absoluteBoundingBox
      ) {
        if (node.parent) {
          nodesToSelect.push(node as SceneNode);
        }

        const { x, y, width, height } = node.absoluteBoundingBox;
        const highlightRect = figma.createRectangle();
        highlightRect.x = x;
        highlightRect.y = y;
        highlightRect.resize(width, height);
        highlightRect.fills = [];
        highlightRect.strokes = [
          { type: "SOLID", color: { r: 1, g: 0, b: 0 } },
        ];
        highlightRect.strokeWeight = 1.5;
        highlightRect.cornerRadius = 3;
        highlightLayers.push(highlightRect);
      }
    } catch (error) {
      console.error(`Error processing node ${id}:`, error);
    }
  }

  return { highlightLayers, nodesToSelect };
}

// Handle highlighting and navigation to misspelled words
async function handleHighlightAndNavigate(nodeIds: string[]): Promise<void> {
  clearOldHighlights();

  if (!nodeIds || nodeIds.length === 0) return;

  const { highlightLayers, nodesToSelect } = await createHighlightRectangles(
    nodeIds
  );

  if (highlightLayers.length > 0) {
    isPluginMakingChange = true;
    const highlightGroup = figma.group(highlightLayers, figma.currentPage);
    highlightGroup.name = HIGHLIGHT_GROUP_NAME;
    highlightGroup.locked = true;
  }

  if (nodesToSelect.length > 0) {
    figma.currentPage.selection = nodesToSelect;
    figma.viewport.scrollAndZoomIntoView(nodesToSelect);
  }

  figma.notify(`Highlighted ${nodesToSelect.length} instances.`);
}

// Handle word replacement in text nodes
async function handleReplaceWord(payload: ReplaceWordPayload): Promise<void> {
  const { nodeIds, oldWord, newWord } = payload;
  let replacedCount = 0;

  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (node && node.type === "TEXT") {
      const font = node.fontName as FontName;
      await figma.loadFontAsync(font);
      isPluginMakingChange = true;

      const beforeText = node.characters;
      const afterText = beforeText.replace(new RegExp(oldWord, "gi"), newWord);
      if (beforeText !== afterText) {
        node.characters = afterText;
        replacedCount++;
      }
    }
  }

  figma.ui.postMessage({ type: "word-replaced", word: oldWord });
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

// Event listeners
function setupEventListeners(): void {
  figma.on("close", () => {
    clearOldHighlights();
  });

  figma.on("documentchange", () => {
    if (isPluginMakingChange) {
      isPluginMakingChange = false;
      return;
    }
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

      case "highlight-and-navigate":
        await handleHighlightAndNavigate(msg.payload);
        break;

      case "replace-word":
        await handleReplaceWord(msg.payload);
        break;

      case "resize-window":
        handleResize(msg.width, msg.height);
        break;

      case "clear-highlights":
        clearOldHighlights();
        break;

      default:
        console.warn(`Unhandled message type: ${msg.type}`);
        break;
    }
  };
}

main();
