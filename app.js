// 1. Inisialisasi Peta Leaflet (Gunakan preferCanvas agar garis jalur 100% stabil & tidak pernah hilang)
const map = L.map('map', { 
    zoomControl: false,
    preferCanvas: true 
}).setView([-7.4935, 110.3950], 14);

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

// Icon Titik Kumpul (Hijau - Selalu di atas garis)
const iconTitikKumpul = L.divIcon({
    className: 'custom-pin',
    html: `<div style="width: 22px; height: 22px; background: #16a34a; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.7);"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
});

// Icon Titik Plang (Oranye Kuning - Selalu di atas garis)
const iconTitikPlang = L.divIcon({
    className: 'custom-pin',
    html: `<div style="width: 16px; height: 16px; background: #f59e0b; border: 2.5px solid #ffffff; border-radius: 50%; box-shadow: 0 2px 5px rgba(0,0,0,0.7);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
});

// Fungsi Menghitung Sudut Arah Panah (Bearing)
function hitungSudut(lat1, lon1, lat2, lon2) {
    const toRad = deg => deg * Math.PI / 180;
    const toDeg = rad => rad * 180 / Math.PI;
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// 2. LOAD BATAS WILAYAH DESA KETEP
fetch('data/batas_desa.geojson?v=' + Date.now())
    .then(r => r.json())
    .then(data => {
        L.geoJSON(data, { 
            style: { 
                color: '#ef4444', 
                weight: 3, 
                dashArray: '6, 6', 
                fillColor: '#ef4444', 
                fillOpacity: 0.12 
            } 
        }).addTo(map);
    }).catch(err => console.error("Error batas_desa:", err));

// 3. LOAD JALUR EVAKUASI (GARIS ORANYE TEBAL + PANAH ARAH)
fetch('data/jalur_evakuasi.geojson?v=' + Date.now())
    .then(r => r.json())
    .then(data => {
        const jalurLayer = L.geoJSON(data, { 
            style: { 
                color: '#ff6b00', 
                weight: 5, 
                opacity: 0.95 
            },
            onEachFeature: (feature) => {
                if (!feature.geometry) return;

                const prosesPanah = (coords) => {
                    if (!coords || coords.length < 2) return;
                    const midIdx = Math.floor(coords.length / 2);
                    const p1 = coords[Math.max(0, midIdx - 1)];
                    const p2 = coords[Math.min(coords.length - 1, midIdx)];
                    const midLat = (p1[1] + p2[1]) / 2;
                    const midLng = (p1[0] + p2[0]) / 2;
                    const angle = hitungSudut(p1[1], p1[0], p2[1], p2[0]);

                    const arrowIcon = L.divIcon({
                        className: 'arrow-icon',
                        html: `<div style="transform: rotate(${angle}deg); color: #ffffff; font-size: 13px; font-weight: bold; text-shadow: 0 0 4px #000;">▲</div>`,
                        iconSize: [14, 14],
                        iconAnchor: [7, 7]
                    });
                    L.marker([midLat, midLng], { icon: arrowIcon, interactive: false, zIndexOffset: 300 }).addTo(map);
                };

                if (feature.geometry.type === 'LineString') {
                    prosesPanah(feature.geometry.coordinates);
                } else if (feature.geometry.type === 'MultiLineString') {
                    feature.geometry.coordinates.forEach(line => prosesPanah(line));
                }
            }
        }).addTo(map);
    }).catch(err => console.error("Error jalur_evakuasi:", err));

// 4. LOAD TITIK KUMPUL & TITIK PLANG (DI ATAS GARIS JALUR)
fetch('data/titik.geojson?v=' + Date.now())
    .then(r => r.json())
    .then(data => {
        if (!data.features) return;
        data.features.forEach(feature => {
            if (!feature.geometry || !feature.geometry.coordinates) return;
            
            const coords = feature.geometry.coordinates;
            const lng = coords[0];
            const lat = coords[1];

            const props = feature.properties || {};
            const nama = props.nama || props.NAMOBJ || props.keterangan || "Titik Evakuasi";
            const teks = JSON.stringify(props).toLowerCase();
            const isPlang = teks.includes('plang') || teks.includes('rambu');

            const marker = L.marker([lat, lng], { 
                icon: isPlang ? iconTitikPlang : iconTitikKumpul,
                zIndexOffset: 700
            }).addTo(map);

            if (isPlang) {
                marker.bindPopup(`
                    <div style="text-align:center; padding: 4px;">
                        <b style="color:#d97706; font-size:12px;">📍 ${nama}</b><br>
                        <small style="color:#64748b;">Plang Penunjuk Arah</small>
                    </div>
                `);
            } else {
                daftarTitikKumpul.push({ nama, lat, lng });

                marker.bindPopup(`
                    <div style="text-align:center; padding: 4px;">
                        <b style="color:#15803d; font-size:13px;">${nama}</b><br><br>
                        <button onclick="buatRute(${lat}, ${lng})" style="background:#dc2626; color:white; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-weight:bold; font-size:11px;">
                            🚗 Rute Ke Sini
                        </button>
                    </div>
                `);
            }
        });
    }).catch(err => console.error("Error titik.geojson:", err));

// 5. PELACAKAN LIVE GPS BERGERAK
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