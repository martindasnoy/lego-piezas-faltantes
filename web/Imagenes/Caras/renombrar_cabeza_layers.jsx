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

  function groupSelectedLayers() {
    // Equivale a: Layer > Group Layers (Ctrl+G)
    executeAction(stringIDToTypeID("groupLayersEvent"), undefined, DialogModes.NO);
  }

  function ungroupLayers() {
    // Equivale a: Layer > Ungroup Layers (Shift+Ctrl+G)
    executeAction(stringIDToTypeID("ungroupLayersEvent"), undefined, DialogModes.NO);
  }

  function renameInGroup(groupLayerSet, prefix, startIndex) {
    var count = 0;

    // En un LayerSet, layers[0] es la capa de ARRIBA del grupo (orden visual)
    for (var i = 0; i < groupLayerSet.layers.length; i++) {
      var l = groupLayerSet.layers[i];

      // Renombrá solo capas normales; si querés incluir grupos también, sacá este if.
      if (l.typename !== "ArtLayer") continue;

      count++;
      l.name = prefix + "_" + pad2(startIndex + count - 1);
    }

    return count;
  }

  // Caso simple: si no hay multiselección (o falla el group), renombramos la activa.
  // Pero intentamos el método de agrupar primero.
  var originalActive = doc.activeLayer;

  try {
    groupSelectedLayers();

    // Si funcionó, ahora la capa activa debería ser el grupo recién creado
    if (doc.activeLayer.typename !== "LayerSet") {
      // Algo raro: revertir y renombrar activa
      try { ungroupLayers(); } catch (_) {}
      doc.activeLayer.name = "Cabeza_01";
      return;
    }

    var tempGroup = doc.activeLayer;

    var renamed = renameInGroup(tempGroup, "Cabeza", 1);

    // Si no había capas ArtLayer dentro (por ejemplo seleccionaste solo grupos),
    // renombramos el grupo mismo.
    if (renamed === 0) {
      tempGroup.name = "Cabeza_01";
    }

    ungroupLayers();

  } catch (e) {
    // Fallback total: renombrar solo la capa activa
    doc.activeLayer = originalActive;
    doc.activeLayer.name = "Cabeza_01";
  }

})();