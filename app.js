// 1. Inisialisasi Peta Leaflet
const map = L.map('map', { zoomControl: false }).setView([-7.4935, 110.3950], 14);

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

// 2. LOAD BATAS WILAYAH DESA KETEP
fetch('data/batas_desa.geojson')
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
    });

// 3. LOAD JALUR EVAKUASI (KONVERSI 3D KE 2D MURNI AGAR 100% MUNCUL)
fetch('data/jalur_evakuasi.geojson')
    .then(r => r.json())
    .then(data => {
        if (!data.features) return;

        // Bersihkan koordinat Z (0.0) dari setiap fitur sebelum dirender
        const cleanFeatures = data.features.map(f => {
            if (!f.geometry) return f;
            const geom = { ...f.geometry };
            if (geom.type === 'LineString') {
                geom.coordinates = geom.coordinates.map(c => [c[0], c[1]]);
            } else if (geom.type === 'MultiLineString') {
                geom.coordinates = geom.coordinates.map(line => line.map(c => [c[0], c[1]]));
            }
            return { ...f, geometry: geom };
        });

        L.geoJSON({ type: "FeatureCollection", features: cleanFeatures }, { 
            style: { 
                color: '#ff6b00', 
                weight: 5, 
                opacity: 0.95 
            } 
        }).addTo(map);
    });

// 4. LOAD TITIK KUMPUL & TITIK PLANG (DI ATAS GARIS JALUR)
fetch('data/titik.geojson')
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
    });

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