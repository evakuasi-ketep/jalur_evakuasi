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
fetch('data/titik.geojson')
    .then(r => r.json())
    .then(data => {
        L.geoJSON(data, {
            pointToLayer: (feature, latlng) => {
                // Cek apakah titik ini plang atau titik kumpul dari atributnya
                const props = feature.properties || {};
                const teks = JSON.stringify(props).toLowerCase();
                const isPlang = teks.includes('plang') || teks.includes('rambu');

                return L.circleMarker(latlng, { 
                    radius: isPlang ? 7 : 9, 
                    fillColor: isPlang ? "#f97316" : "#16a34a", // Oranye untuk Plang, Hijau untuk Titik Kumpul
                    color: "#ffffff", 
                    weight: 2, 
                    fillOpacity: 0.95 
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
                            <b style="color:#c2410c; font-size:12px;">📍 ${nama}</b><br>
                            <small style="color:#64748b;">Plang Penunjuk Arah</small>
                        </div>
                    `);
                } else {
                    // Masukkan ke daftar tujuan Evakuasi Otomatis
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
    }).catch(err => console.log("Gagal memuat titik.geojson:", err));

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