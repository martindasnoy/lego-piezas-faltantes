#target photoshop
app.bringToFront();

if (!app.documents.length) {
    alert("No hay documento abierto");
}

var doc = app.activeDocument;
var folder = Folder.selectDialog("Elegí carpeta de exportación");
if (!folder) exit();

function padName(n) {
    return n.replace(/[\\\/:*?"<>|]/g, "_");
}

var opts = new ExportOptionsSaveForWeb();
opts.format = SaveDocumentType.PNG;
opts.PNG8 = false;
opts.transparency = true;
opts.interlaced = false;
opts.quality = 100;

function hideAll() {
    for (var i = 0; i < doc.layers.length; i++) {
        doc.layers[i].visible = false;
    }
}

for (var i = doc.layers.length - 1; i >= 0; i--) {

    var layer = doc.layers[i];

    if (layer.typename !== "ArtLayer") continue;

    hideAll();

    layer.visible = true;
    doc.activeLayer = layer;

    var file = new File(folder + "/" + padName(layer.name) + ".png");

    doc.exportDocument(file, ExportType.SAVEFORWEB, opts);
}

alert("Export terminado");