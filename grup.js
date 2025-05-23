require("dotenv").config(); // Untuk memuat variabel dari .env jika ada
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");

// --- KONFIGURASI ---
// Mengambil inspirasi dari struktur CONFIG yang Anda berikan
const CONFIG = {
  WHATSAPP_CLIENT: {
    // Konfigurasi LocalAuth dengan dataPath
    authStrategy: new LocalAuth({
      dataPath: process.env.WWEBJS_AUTH_PATH || "./.wwebjs_auth", // Path bisa diatur via .env atau default
    }),
    puppeteer: {
      headless: true, // Biasanya true untuk proses background
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      // Mengambil executablePath dari environment variable, dengan fallback berdasarkan OS
      executablePath:
        process.env.CHROME_EXECUTABLE_PATH ||
        (process.platform === "darwin" // macOS
          ? "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
          : process.platform === "linux" // Linux
          ? "/usr/bin/google-chrome" // Path umum, bisa berbeda
          : undefined), // Windows biasanya tidak perlu path eksplisit jika Chrome diinstal standar
    },
  },
  GROUPS_FILE_PATH: path.join(
    __dirname,
    process.env.GROUPS_JSON_FILENAME || "whatsapp_groups_list.json"
  ), // Nama file output bisa diatur
};

// --- FUNGSI UTAMA ---

class WhatsAppGroupFetcher {
  constructor() {
    // Periksa apakah executablePath valid jika disetel secara eksplisit atau terdeteksi
    if (
      CONFIG.WHATSAPP_CLIENT.puppeteer.executablePath &&
      !fs.existsSync(CONFIG.WHATSAPP_CLIENT.puppeteer.executablePath)
    ) {
      console.warn(
        `PERINGATAN: Chrome executablePath '${CONFIG.WHATSAPP_CLIENT.puppeteer.executablePath}' tidak ditemukan. Whatsapp-web.js akan mencoba mencari Chrome secara otomatis.`
      );
      // Hapus path jika tidak valid agar wwebjs mencari otomatis
      CONFIG.WHATSAPP_CLIENT.puppeteer.executablePath = undefined;
    } else if (CONFIG.WHATSAPP_CLIENT.puppeteer.executablePath) {
      console.log(
        `Menggunakan Chrome dari path: ${CONFIG.WHATSAPP_CLIENT.puppeteer.executablePath}`
      );
    } else {
      console.log(
        "Tidak ada CHROME_EXECUTABLE_PATH yang diatur atau terdeteksi, whatsapp-web.js akan mencoba mencari Chrome secara otomatis."
      );
    }

    this.client = new Client(CONFIG.WHATSAPP_CLIENT);
    this.initializeEvents();
  }

  initializeEvents() {
    console.log("Menginisialisasi klien WhatsApp...");
    console.log(
      `Sesi akan disimpan/dimuat dari: ${CONFIG.WHATSAPP_CLIENT.authStrategy.dataPath}`
    );

    this.client.on("qr", (qr) => {
      console.log(
        "QR Code diterima, silakan pindai dengan aplikasi WhatsApp Anda:"
      );
      qrcode.generate(qr, { small: true });
    });

    this.client.on("authenticated", () => {
      console.log("Autentikasi berhasil!");
    });

    this.client.on("auth_failure", (msg) => {
      console.error("Autentikasi GAGAL:", msg);
      console.error(
        `Pastikan path sesi di '${CONFIG.WHATSAPP_CLIENT.authStrategy.dataPath}' dapat diakses dan tidak korup.`
      );
      console.error(
        "Jika ini adalah kali pertama atau sesi lama bermasalah, coba hapus folder sesi tersebut dan jalankan ulang."
      );
      process.exit(1);
    });

    this.client.on("ready", async () => {
      console.log("Klien WhatsApp SIAP!");
      await this.fetchAndSaveGroupList();
      await this.shutdown();
    });

    this.client.on("disconnected", (reason) => {
      console.log("Klien WhatsApp terputus:", reason);
      // Anda mungkin ingin menambahkan logika reconnect di sini jika ini untuk bot jangka panjang
    });
  }

  async fetchAndSaveGroupList() {
    try {
      console.log("Mengambil daftar grup WhatsApp...");
      const chats = await this.client.getChats();
      const groups = chats.filter((chat) => chat.isGroup);

      const groupList = groups.map((group) => ({
        id: group.id._serialized,
        name: group.name,
        participantCount: group.participants
          ? group.participants.length
          : "Tidak diketahui (membutuhkan fetchParticipants)", // Lebih baik ambil jumlah partisipan jika ada
        isReadOnly: group.isReadOnly || false,
        archived: group.archived || false,
        timestamp: group.timestamp,
      }));

      fs.writeFileSync(
        CONFIG.GROUPS_FILE_PATH,
        JSON.stringify(groupList, null, 2) // null, 2 untuk pretty print JSON
      );

      console.log(
        `Berhasil! ${groupList.length} grup WhatsApp telah disimpan ke ${CONFIG.GROUPS_FILE_PATH}`
      );
    } catch (error) {
      console.error(
        "Terjadi kesalahan saat mengambil atau menyimpan daftar grup:",
        error
      );
    }
  }

  async initializeClient() {
    try {
      await this.client.initialize();
    } catch (error) {
      console.error("Gagal menginisialisasi klien WhatsApp:", error);
      if (error.message.includes("Could not find browser revision")) {
        console.error(
          "Ini mungkin karena Puppeteer tidak dapat menemukan instalasi Chrome yang kompatibel."
        );
        console.error(
          "Pastikan Chrome atau Chromium terinstal dan CHROME_EXECUTABLE_PATH (jika diatur) sudah benar."
        );
      }
      process.exit(1);
    }
  }

  async shutdown() {
    console.log("Menutup klien WhatsApp...");
    if (this.client) {
      try {
        await this.client.destroy();
        console.log("Klien berhasil ditutup.");
      } catch (e) {
        console.error("Gagal menutup klien:", e);
      }
    }
    process.exit(0);
  }
}

// --- Jalankan Aplikasi ---
(async () => {
  const groupFetcher = new WhatsAppGroupFetcher();
  await groupFetcher.initializeClient();

  // Menangani interupsi (Ctrl+C) untuk mematikan dengan benar
  process.on("SIGINT", async () => {
    console.log("Menerima SIGINT (Ctrl+C). Mematikan...");
    await groupFetcher.shutdown();
  });
})();
