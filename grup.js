const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs"); // Modul 'fs' untuk operasi file

const client = new Client({
  authStrategy: new LocalAuth(), // Menggunakan LocalAuth untuk menyimpan sesi
  puppeteer: {
    // headless: false, // Set true untuk menjalankan tanpa browser UI
    args: ["--no-sandbox", "--disable-setuid-sandbox"], // Diperlukan untuk beberapa lingkungan Linux
  },
});

console.log("Memulai klien untuk mengambil daftar grup...");

client.on("qr", (qr) => {
  console.log("QR Diterima, pindai dengan WhatsApp Anda untuk login:");
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
  console.log("Terautentikasi!");
});

client.on("auth_failure", (msg) => {
  console.error("Autentikasi GAGAL:", msg);
  process.exit(1); // Keluar jika autentikasi gagal
});

client.on("ready", async () => {
  console.log("Klien Siap! Mengambil daftar grup...");

  try {
    const chats = await client.getChats();
    const groups = chats.filter((chat) => chat.isGroup);

    if (groups.length > 0) {
      const groupData = groups.map((group) => ({
        id: group.id._serialized,
        name: group.name,
        isReadOnly: group.isReadOnly,
        unreadCount: group.unreadCount,
        timestamp: group.timestamp, // Timestamp dari aktivitas terakhir
        participantCount: group.participants
          ? group.participants.length
          : "Tidak diketahui (perlu fetch)", // Jumlah partisipan
        archived: group.archived || false,
      }));

      const outputFile = "whatsapp_groups.json";
      fs.writeFileSync(outputFile, JSON.stringify(groupData, null, 2));
      console.log(`Daftar grup berhasil disimpan ke ${outputFile}`);
      console.log(`Total grup ditemukan: ${groupData.length}`);

      // Anda bisa menampilkan beberapa info grup di konsol jika mau
      // groupData.slice(0, 5).forEach(g => console.log(`- ${g.name} (ID: ${g.id})`));
    } else {
      console.log("Tidak ada grup yang ditemukan.");
    }
  } catch (error) {
    console.error("Gagal mengambil daftar grup:", error);
  } finally {
    // Setelah selesai, matikan klien
    console.log("Menutup klien...");
    await client.destroy();
    process.exit(0);
  }
});

client.initialize().catch((err) => {
  console.error("Gagal inisialisasi klien:", err);
  process.exit(1);
});

// Handle Ctrl+C untuk mematikan dengan benar jika proses berjalan lama
process.on("SIGINT", async () => {
  console.log("Mematikan klien karena interupsi...");
  if (client) {
    try {
      await client.destroy();
    } catch (e) {
      console.error("Gagal destroy client saat SIGINT:", e);
    }
  }
  process.exit(0);
});
