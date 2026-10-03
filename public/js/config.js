// ====== YOUR SOUNDS - this is the file to edit =====================================
// Audio files live in  public/sounds/  . Use paths like 'sounds/yourfile.mp3'.
// Keep files small (under ~200 KB) so they play instantly on phones.
const AUDIO={
 // Played when a pawn is captured ("eliminated").
 // To change it: replace public/sounds/capture.mp3 with your file (same name),
 // or point this at a different file. Leave '' to use the built-in synth sound.
 capture:'sounds/capture.mp3',
 captureVolume:1,                  // 0 to 1

 // Soundboard buttons in the chat > Sounds tab (everyone in the room hears them).
 // Leave src '' for an empty slot.
 board:[
  {label:'Faaa',src:'sounds/faaa.mp3'},{label:'Sound 2',src:''},{label:'Sound 3',src:''},{label:'Sound 4',src:''},
  {label:'Sound 5',src:''},{label:'Sound 6',src:''},{label:'Sound 7',src:''},{label:'Sound 8',src:''}]};
// ===================================================================================
