export function collectionPrintAction(autoPrint,preview){
 if(autoPrint)return preview?'preview-and-print':'print';
 return preview?'preview':'none';
}
