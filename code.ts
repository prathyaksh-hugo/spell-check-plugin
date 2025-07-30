const HIGHLIGHT_GROUP_NAME = 'SPELL CHECK HIGHLIGHTS';
let isPluginMakingChange = false;

function clearOldHighlights() {
  try {
    const oldHighlightGroup = figma.currentPage.findOne(node => node.name === HIGHLIGHT_GROUP_NAME);
    if (oldHighlightGroup) {
      isPluginMakingChange = true;
      oldHighlightGroup.remove();
    }
  } catch (error) {
    console.error("Error clearing old highlights:", error);
  }
}

async function main() {
  await figma.loadAllPagesAsync();
  figma.showUI(__html__, { width: 450, height: 550 });

  figma.on('close', () => {
    clearOldHighlights();
  });

  figma.on('documentchange', (event) => {
    if (isPluginMakingChange) {
      isPluginMakingChange = false;
      return;
    }
    figma.ui.postMessage({ type: 're-check-document' });
  });

  figma.ui.onmessage = async (msg: { type: string, payload?: any, width?: number, height?: number }) => {
    if (msg.type === 'spell-check') {
      clearOldHighlights();
      const textNodes = figma.currentPage.findAllWithCriteria({ types: ['TEXT'] });
      const allTextData = textNodes.map(node => ({ id: node.id, text: node.characters }));
      figma.ui.postMessage({ type: 'text-to-check', payload: allTextData });
    } 
    
    else if (msg.type === 'highlight-and-navigate') {
      clearOldHighlights(); 
      const nodeIds = msg.payload;
      if (!nodeIds || nodeIds.length === 0) return;

      const highlightLayers = [];
      const nodesToSelect: SceneNode[] = [];

      for (const id of nodeIds) {
        try {
            const node = await figma.getNodeByIdAsync(id);
            if (node && !node.removed && 'absoluteBoundingBox' in node && node.absoluteBoundingBox) {
                if ('parent' in node && node.parent) {
                    nodesToSelect.push(node as SceneNode);
                }
                const { x, y, width, height } = node.absoluteBoundingBox;
                const highlightRect = figma.createRectangle();
                highlightRect.x = x;
                highlightRect.y = y;
                highlightRect.resize(width, height);
                highlightRect.fills = [];
                highlightRect.strokes = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
                highlightRect.strokeWeight = 1.5;
                highlightRect.cornerRadius = 3;
                highlightLayers.push(highlightRect);
            }
        } catch (error) {
            console.error(`Error processing node ${id}:`, error);
        }
      }
      
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

    else if (msg.type === 'replace-word') {
      const { nodeIds, oldWord, newWord } = msg.payload;
      for (const id of nodeIds) {
          const node = await figma.getNodeByIdAsync(id);
          if (node && node.type === 'TEXT') {
              const font = node.fontName as FontName;
              await figma.loadFontAsync(font);
              isPluginMakingChange = true;
              node.characters = node.characters.replace(new RegExp(oldWord, 'g'), newWord);
          }
      }
      figma.ui.postMessage({ type: 'word-replaced', word: oldWord });
      figma.notify(`Replaced "${oldWord}" with "${newWord}".`);
    }

    else if (msg.type === 'resize-window') {
      if (msg.width && msg.height) {
        figma.ui.resize(msg.width, msg.height);
      }
    }
   
    else if (msg.type === 'clear-highlights') {
        clearOldHighlights();
    }
  };
}

main();
