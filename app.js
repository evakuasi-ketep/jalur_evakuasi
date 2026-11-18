// 1. Inisialisasi Peta Leaflet
const map = L.map('map', { zoomControl: false }).setView([-7.4935, 110.3950], 14);

// Membuat Pane Khusus agar Titik Kumpul & Plang SELALU di atas garis jalur
map.createPane('paneBatas');
map.getPane('paneBatas').style.zIndex = 350;

map.createPane('paneJalur');
map.getPane('paneJalur').style.zIndex = 400;

map.createPane('paneTitik');
map.getPane('paneTitik').style.zIndex = 500; // Paling atas agar tidak ketutup jalur!

// Basemap (Satelit Esri & OpenStreetMap)
const esriSatelit = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
    attribution: 'Esri World Imagery' 
}).addTo(map);

const osmMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
    maxZoom: 18, 
    attribution: 'OpenStreetMap' 
});

let currentBasemap = 'satelit';

function toggleBasemap() {
    if (currentBasemap === 'satelit') {
        map.removeLayer(esriSatelit); 
        map.addLayer(osmMap); 
        currentBasemap = 'osm';
    } else {
        map.removeLayer(osmMap); 
        map.addLayer(esriSatelit); 
        currentBasemap = 'satelit';
    }
}

let userMarker = null;
let accuracyCircle = null;
let routingControl = null;
let userCoords = null;
let watchId = null;
let daftarTitikKumpul = [];

// Marker Icon Bulat Biru Google Maps
const googleBlueDotIcon = L.divIcon({
    className: 'gmaps-user-icon',
    html: `<div class="gmaps-pulse"></div><div class="gmaps-blue-dot"></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
});

// 2. LOAD BATAS WILAYAH DESA KETEP
fetch('data/batas_desa.geojson')
    .then(r => r.json())
    .then(data => {
        L.geoJSON(data, { 
            pane: 'paneBatas',
            style: { 
                color: '#ef4444', 
                weight: 3, 
                dashArray: '6, 6', 
                fillColor: '#ef4444', 
                fillOpacity: 0.12 
            } 
        }).addTo(map);
    }).catch(err => console.warn("Gagal memuat batas_desa.geojson:", err));

// 3. LOAD JALUR EVAKUASI + TANDA PANAH ARAH
fetch('data/jalur_evakuasi.geojson')
    .then(r => r.json())
    .then(data => {
        const jalurLayer = L.geoJSON(data, { 
            pane: 'paneJalur',
            style: { 
                color: '#f97316', 
                weight: 5, 
                opacity: 0.9 
            } 
        }).addTo(map);

        // Tambahkan Simbol Panah di sepanjang garis jalur evakuasi
        if (typeof L.polylineDecorator === 'function') {
            jalurLayer.eachLayer(layer => {
                L.polylineDecorator(layer, {
                    patterns: [
                        {
                            offset: 25,
                            repeat: 65, // Jarak antar panah (pixel)
                            symbol: L.Symbol.arrowHead({
                                pixelSize: 10,
                                polygon: false,
                                pathOptions: { 
                                    stroke: true, 
                                    color: '#ffffff', // Warna panah putih terang agar kontras
                                    weight: 2.5,
                                    opacity: 0.95
                                }
                            })
                        }
                    ]
                }).addTo(map);
            });
        }
    }).catch(err => console.warn("Gagal memuat jalur_evakuasi.geojson:", err));

// 4. LOAD GABUNGAN TITIK KUMPUL & TITIK PLANG (Posisi di lapisan paling atas)
fetch('data/titik.geojson')
    .then(r => r.json())
    .then(data => {
        const titikLayer = L.geoJSON(data, {
            pane: 'paneTitik',
            pointToLayer: (feature, latlng) => {
                const props = feature.properties || {};
                const teks = JSON.stringify(props).toLowerCase();
                const isPlang = teks.includes('plang') || teks.includes('rambu');

                return L.circleMarker(latlng, { 
                    pane: 'paneTitik',
                    radius: isPlang ? 8 : 10, 
                    fillColor: isPlang ? "#f59e0b" : "#16a34a", // Kuning/Oranye terang = Plang, Hijau = Titik Kumpul
                    color: "#ffffff", 
                    weight: 2.5, 
                    fillOpacity: 1 
                });
            },
            onEachFeature: (feature, layer) => {
                const props = feature.properties || {};
                const nama = props.nama || props.NAMOBJ || props.keterangan || "Titik Evakuasi";
                const teks = JSON.stringify(props).toLowerCase();
                const isPlang = teks.includes('plang') || teks.includes('rambu');
                const lat = layer.getLatLng().lat;
                const lng = layer.getLatLng().lng;

                if (isPlang) {
                    layer.bindPopup(`
                        <div style="text-align:center; padding: 4px;">
                            <b style="color:#d97706; font-size:12px;">📍 ${nama}</b><br>
                            <small style="color:#64748b;">Plang Penunjuk Arah</small>
                        </div>
                    `);
                } else {
                    daftarTitikKumpul.push({ nama, lat, lng });

                    layer.bindPopup(`
                        <div style="text-align:center; padding: 4px;">
                            <b style="color:#15803d; font-size:13px;">${nama}</b><br><br>
                            <button onclick="buatRute(${lat}, ${lng})" style="background:#dc2626; color:white; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-weight:bold; font-size:11px;">
                                🚗 Rute Ke Sini
                            </button>
                        </div>
                    `);
                }
            }
        }).addTo(map);

        titikLayer.bringToFront();
    }).catch(err => console.warn("Gagal memuat titik.geojson:", err));

// 5. PELACAKAN LIVE GPS BERGERAK (Real-time WatchPosition)
function lacakLokasi(callback) {
    if (!navigator.geolocation) {
        alert("GPS tidak didukung di perangkat ini.");
        return;
    }

    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
    }

    watchId = navigator.geolocation.watchPosition(pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;
        userCoords = { lat, lng };

        if (userMarker) {
            userMarker.setLatLng([lat, lng]);
        } else {
            userMarker = L.marker([lat, lng], { icon: googleBlueDotIcon, zIndexOffset: 1000 }).addTo(map);
            map.flyTo([lat, lng], 16, { animate: true });
        }

        if (accuracyCircle) {
            accuracyCircle.setLatLng([lat, lng]).setRadius(accuracy);
        } else {
            accuracyCircle = L.circle([lat, lng], {
                radius: accuracy,
                color: '#1a73e8',
                fillColor: '#1a73e8',
                fillOpacity: 0.15,
                weight: 1
            }).addTo(map);
        }

        if (callback) {
            callback();
            callback = null;
        }
    }, err => {
        console.warn("Sedang mencari sinyal GPS...");
    }, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000
    });
}

// 6. PERHITUNGAN JARAK HAVERSINE
function hitungJarak(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// 7. FITUR EVAKUASI OTOMATIS
function evakuasiOtomatis() {
    document.getElementById('alert-banner').style.display = 'block';

    const prosesEvakuasi = () => {
        if (!userCoords || daftarTitikKumpul.length === 0) return;

        let titikTerdekat = null;
        let jarakTermurah = Infinity;

        daftarTitikKumpul.forEach(titik => {
            const d = hitungJarak(userCoords.lat, userCoords.lng, titik.lat, titik.lng);
            if (d < jarakTermurah) {
                jarakTermurah = d;
                titikTerdekat = titik;
            }
        });

        if (titikTerdekat) {
            document.getElementById('alert-banner').innerHTML = 
                `🚨 EVAKUASI: Jalur menuju <b>${titikTerdekat.nama}</b> (${jarakTermurah.toFixed(2)} km) telah dibuat!`;
            
            buatRute(titikTerdekat.lat, titikTerdekat.lng);
        }
    };

    if (!userCoords) {
        lacakLokasi(prosesEvakuasi);
    } else {
        prosesEvakuasi();
    }
}

// 8. PEMBUAT RUTE NAVIGASI BAHASA INDONESIA
function buatRute(destLat, destLng) {
    if (!userCoords) {
        lacakLokasi(() => buatRute(destLat, destLng));
        return;
    }

    if (routingControl) map.removeControl(routingControl);

    routingControl = L.Routing.control({
        waypoints: [
            L.latLng(userCoords.lat, userCoords.lng),
            L.latLng(destLat, destLng)
        ],
        language: 'id',
        lineOptions: {
            styles: [{ color: '#2563eb', opacity: 0.9, weight: 6 }]
        },
        createMarker: () => null,
        addWaypoints: false,
        routeWhileDragging: false
    }).addTo(map);
}

// Jalankan pencarian lokasi awal
lacakLokasi();