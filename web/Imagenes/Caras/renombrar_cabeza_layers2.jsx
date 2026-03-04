#target photoshop
app.bringToFront();

(function () {
  if (!app.documents.length) {
    alert("No hay documento abierto.");
    return;
  }

  var doc = app.activeDocument;

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  // Devuelve el contenedor a renombrar:
  // - si la capa activa es un grupo: ese grupo
  // - si no: el documento (capas de primer nivel)
  function getContainer() {
    var a = doc.activeLayer;
    if (a && a.typename === "LayerSet") return a;
    return doc;
  }

  // Recorre SOLO ArtLayers del contenedor (sin entrar en subgrupos)
  // Si querés incluir subgrupos, te dejo otra versión abajo.
  function getArtLayers(container) {
    var arr = [];
    for (var i = 0; i < container.layers.length; i++) {
      if (container.layers[i].typename === "ArtLayer") arr.push(container.layers[i]);
    }
    return arr;
  }

  var container = getContainer();
  var layers = getArtLayers(container);

  if (!layers.length) {
    alert("No encontré capas tipo ArtLayer para renombrar.\nTip: activá un grupo (folder) que tenga capas dentro.");
    return;
  }

  // En el DOM, layers[0] suele ser la capa de ARRIBA visualmente.
  // Renombramos de arriba hacia abajo.
  for (var i = 0; i < layers.length; i++) {
    // Evita renombrar Background si existiera como ArtLayer especial
    try {
      layers[i].name = "Cabeza_" + pad2(i + 1);
    } catch (e) {}
  }

  alert("Renombradas " + layers.length + " capas en: " + (container.typename === "LayerSet" ? ("grupo '" + container.name + "'") : "nivel raíz"));
})();