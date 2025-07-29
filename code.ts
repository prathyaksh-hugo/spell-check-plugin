
if (figma.editorType === 'figma') {

  figma.showUI(__html__);

  figma.ui.onmessage = async (msg: {type: string}) => {

    if(msg.type === 'spell-check'){
      const textNodes = figma.currentPage.findAllWithCriteria({
        types: ['TEXT']
      })

      const allTextContent: string [] = [] ;
      for(const node of textNodes){
        allTextContent.push(node.characters)
      }
      console.log('All extracted text:', allTextContent);
      console.log(`Found and extracted text from ${allTextContent.length} text nodes.`);

  
  figma.notify(`Found ${allTextContent.length} text layers on the page.`);
  figma.ui.postMessage({ type: 'all-text-data', payload: allTextContent });

    }
  }

}

if (figma.editorType === 'figjam') {

  figma.showUI(__html__);

}


if (figma.editorType === 'slides') {

  figma.showUI(__html__);

}
