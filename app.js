const map = L.map('map').setView([-7.4935, 110.3950], 14);

// Layer Satelit & Street Map
const esriSatelit = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri'
}).addTo(map);

const osmMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: 'Peta Evakuasi Ketep'
});

L.control.layers({ "Satelit (Esri)": esriSatelit, "Peta Jalan": osmMap }).addTo(map);

// 1. Load Batas Wilayah Desa Ketep (Polygon Putus-putus Merah Tua)
fetch('data/batas_desa.geojson').then(r => r.json()).then(data => {
    L.geoJSON(data, {
        style: {
            color: '#991b1b',
            weight: 3,
            dashArray: '6, 6',
            fillColor: '#ef4444',
            fillOpacity: 0.12
        },
        onEachFeature: (feature, layer) => {
            const nama = feature.properties.NAMOBJ || "Wilayah Desa Ketep";
            layer.bindTooltip(`<b>${nama}</b>`);
        }
    }).addTo(map);
});

// 2. Load Jalur Evakuasi
fetch('data/jalur_evakuasi.geojson').then(r => r.json()).then(data => {
    L.geoJSON(data, { style: { color: '#e65100', weight: 5, opacity: 0.9 } }).addTo(map);
});

// 3. Load Titik Kumpul / Plang
fetch('data/titik_kumpul.geojson').then(r => r.json()).then(data => {
    L.geoJSON(data, {
        pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius: 8, fillColor: "#2e7d32", color: "#fff", weight: 2, fillOpacity: 0.9 }),
        onEachFeature: (feature, layer) => {
            layer.bindPopup(`<b>${feature.properties.nama}</b><br>PJ: ${feature.properties.penanggung_jawab}`);
        }
    }).addTo(map);
});

function lacakLokasi() { map.locate({ setView: true, maxZoom: 16 }); }
map.on('locationfound', e => L.marker(e.latlng).addTo(map).bindPopup("Lokasi Anda").openPopup());