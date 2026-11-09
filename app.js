// 1. Inisialisasi Peta Leaflet
const map = L.map('map', { zoomControl: false }).setView([-7.4935, 110.3950], 14);

// Tile Layer Basemap (Satelit Esri & OpenStreetMap)
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

// Variabel Kontrol GPS & Navigasi
let userMarker = null;
let accuracyCircle = null;
let routingControl = null;
let userCoords = null;
let watchId = null;
let daftarTitikKumpul = [];

// Marker Icon Bulat Biru Google Maps (CSS DivIcon)
const googleBlueDotIcon = L.divIcon({
    className: 'gmaps-user-icon',
    html: `<div class="gmaps-pulse"></div><div class="gmaps-blue-dot"></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
});

// 2. Load Data GeoJSON Desa Ketep
fetch('data/batas_desa.geojson')
    .then(r => r.json())
    .then(data => {
        L.geoJSON(data, { 
            style: { color: '#991b1b', weight: 3, dashArray: '6, 6', fillColor: '#ef4444', fillOpacity: 0.15 } 
        }).addTo(map);
    }).catch(err => console.log("Batas desa belum di-load"));

fetch('data/jalur_evakuasi.geojson')
    .then(r => r.json())
    .then(data => {
        L.geoJSON(data, { 
            style: { color: '#e65100', weight: 5, opacity: 0.9 } 
        }).addTo(map);
    }).catch(err => console.log("Jalur evakuasi belum di-load"));

fetch('data/titik_kumpul.geojson')
    .then(r => r.json())
    .then(data => {
        L.geoJSON(data, {
            pointToLayer: (feature, latlng) => L.circleMarker(latlng, { 
                radius: 9, 
                fillColor: "#16a34a", 
                color: "#ffffff", 
                weight: 2, 
                fillOpacity: 0.95 
            }),
            onEachFeature: (feature, layer) => {
                const nama = feature.properties ? (feature.properties.nama || feature.properties.NAMOBJ || "Titik Evakuasi") : "Titik Evakuasi";
                const lat = layer.getLatLng().lat;
                const lng = layer.getLatLng().lng;

                // Simpan koordinat ke daftar untuk kalkulasi titik terdekat
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
        }).addTo(map);
    }).catch(err => console.log("Titik kumpul belum di-load"));

// 3. Fitur GPS Live Tracking Real-time (Bisa Bergerak)
function lacakLokasi(callback) {
    if (!navigator.geolocation) {
        alert("GPS tidak didukung oleh browser/HP Anda.");
        return;
    }

    // Bersihkan pelacak sebelumnya jika ada
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
    }

    // Memantau pergeseran HP secara terus menerus (realtime)
    watchId = navigator.geolocation.watchPosition(pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;
        userCoords = { lat, lng };

        // Update / Buat Marker Bulatan Biru Google Maps
        if (userMarker) {
            userMarker.setLatLng([lat, lng]);
        } else {
            userMarker = L.marker([lat, lng], { icon: googleBlueDotIcon }).addTo(map);
            map.flyTo([lat, lng], 16, { animate: true });
        }

        // Radius Akurasi GPS (Soft Blue Circle)
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
            callback = null; // Eksekusi callback hanya 1x di awal
        }
    }, err => {
        console.warn("Sedang mengunci sinyal GPS...");
    }, {
        enableHighAccuracy: true, // Sensor presisi tinggi HP
        maximumAge: 0,
        timeout: 15000
    });
}

// 4. Formula Jarak Haversine (Mencari Titik Terdekat)
function hitungJarak(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius bumi dalam KM
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// 5. Fitur Otomatisasi Mode Darurat Bencana
function evakuasiOtomatis() {
    document.getElementById('alert-banner').style.display = 'block';

    const prosesEvakuasi = () => {
        if (!userCoords || daftarTitikKumpul.length === 0) return;

        let titikTerdekat = null;
        let jarakTermurah = Infinity;

        // Cari titik kumpul yang paling dekat dari posisi HP warga
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

// 6. Pembuat Rute Navigasi Berbahasa Indonesia
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
        language: 'id', // Bahasa Indonesia Penuh
        lineOptions: {
            styles: [{ color: '#2563eb', opacity: 0.9, weight: 6 }]
        },
        createMarker: () => null,
        addWaypoints: false,
        routeWhileDragging: false
    }).addTo(map);
}

// Jalankan pencarian lokasi otomatis di awal aplikasi dimuat
lacakLokasi();