require("dotenv").config(); // Muat variabel dari .env
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const cron = require("node-cron"); // Untuk penjadwalan
const fs = require("fs"); // Untuk memeriksa path executable Chrome
const path = require("path"); // Untuk path
const db = require("./database"); // File database Anda

// --- KONFIGURASI ---
const CONFIG = {
  WHATSAPP_CLIENT: {
    authStrategy: new LocalAuth({
      dataPath: process.env.WWEBJS_AUTH_PATH || "./.wwebjs_auth_bot", // Path sesi bot, bedakan jika perlu dari skrip lain
    }),
    puppeteer: {
      headless: process.env.PUPPETEER_HEADLESS !== "false", // Default true, bisa diset false via env
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", // Tambahan untuk lingkungan Docker/CI
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        // '--single-process', // HANYA untuk Windows, jika ada masalah
        "--disable-gpu",
      ],
      executablePath:
        process.env.CHROME_EXECUTABLE_PATH ||
        (process.platform === "darwin"
          ? "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
          : process.platform === "linux"
          ? "/usr/bin/google-chrome"
          : undefined),
    },
  },
  // Ambil TARGET_GROUP_ID dari environment variable, dengan fallback
  TARGET_GROUP_ID: process.env.TARGET_GROUP_ID || "120363354858071561@g.us", // PENTING: Ganti fallback ini atau set via .env
  CRON_DAILY_REMINDER: process.env.CRON_DAILY_REMINDER || "0 9 * * *", // Default jam 9 pagi setiap hari
  TIMEZONE_CRON: process.env.TIMEZONE_CRON || "Asia/Jakarta",
};

// Validasi TARGET_GROUP_ID
if (CONFIG.TARGET_GROUP_ID === "GROUP_ID_ANDA@g.us") {
  console.warn(
    "PERINGATAN: TARGET_GROUP_ID belum diatur dengan benar. Silakan set variabel environment TARGET_GROUP_ID atau ubah di dalam kode."
  );
  // Pertimbangkan untuk keluar jika ID grup sangat krusial dan belum diset
  // process.exit(1);
}

// Periksa path executable Chrome
if (
  CONFIG.WHATSAPP_CLIENT.puppeteer.executablePath &&
  !fs.existsSync(CONFIG.WHATSAPP_CLIENT.puppeteer.executablePath)
) {
  console.warn(
    `PERINGATAN: Chrome executablePath '${CONFIG.WHATSAPP_CLIENT.puppeteer.executablePath}' tidak ditemukan. Whatsapp-web.js akan mencoba mencari Chrome secara otomatis.`
  );
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

const client = new Client(CONFIG.WHATSAPP_CLIENT);

client.on("qr", (qr) => {
  console.log("QR Diterima, pindai dengan WhatsApp Anda:");
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
  console.log("Terautentikasi!");
});

client.on("auth_failure", (msg) => {
  console.error("Autentikasi GAGAL:", msg);
  console.error(
    `Pastikan path sesi di '${CONFIG.WHATSAPP_CLIENT.authStrategy.dataPath}' dapat diakses dan tidak korup.`
  );
  console.error(
    "Jika ini adalah kali pertama atau sesi lama bermasalah, coba hapus folder sesi tersebut dan jalankan ulang."
  );
});

client.on("ready", () => {
  console.log("Bot Siap!");
  console.log(`Bot akan memantau grup dengan ID: ${CONFIG.TARGET_GROUP_ID}`);
  console.log(
    `Pengingat harian dijadwalkan dengan cron: "${CONFIG.CRON_DAILY_REMINDER}" zona waktu "${CONFIG.TIMEZONE_CRON}"`
  );

  // Jadwalkan pengingat harian menggunakan node-cron
  if (cron.validate(CONFIG.CRON_DAILY_REMINDER)) {
    cron.schedule(CONFIG.CRON_DAILY_REMINDER, sendDailyReminder, {
      scheduled: true,
      timezone: CONFIG.TIMEZONE_CRON,
    });
    console.log("Pengingat harian berhasil dijadwalkan.");
    // Opsi: Kirim pengingat sekali saat bot baru jalan jika diinginkan
    // sendDailyReminder();
  } else {
    console.error("Jadwal cron tidak valid:", CONFIG.CRON_DAILY_REMINDER);
  }
});

client.on("message", async (message) => {
  const chat = await message.getChat();
  const sender = await message.getContact();
  const senderName = sender.pushname || sender.name || sender.number;
  const senderNumber = sender.id.user;

  if (
    chat.isGroup &&
    chat.id._serialized === CONFIG.TARGET_GROUP_ID &&
    !message.fromMe
  ) {
    console.log(
      `[${new Date().toLocaleString()}] Pesan dari [${senderName} (${senderNumber})] di grup [${
        chat.name
      }]: ${message.body}`
    );

    const body = message.body.trim();

    if (body.toLowerCase().includes("!ta-progres")) {
      const progressMessage = body
        .substring(
          body.toLowerCase().indexOf("!ta-progres") + "!ta-progres".length
        )
        .trim();
      if (progressMessage) {
        try {
          await db.addProgress(senderName, senderNumber, progressMessage);
          message.reply(`Progres dari ${senderName} berhasil disimpan! 👍`);
          console.log(
            `Progres disimpan untuk ${senderName}: ${progressMessage}`
          );
        } catch (error) {
          console.error("Gagal menyimpan progres:", error);
          message.reply("Terjadi kesalahan saat menyimpan progres. 🙁");
        }
      } else {
        message.reply("Format salah. Gunakan: !ta-progres {isi progres Anda}");
      }
    } else if (body.toLowerCase() === "!check") {
      // Dibuat case-insensitive
      try {
        const allProgress = await db.getAllProgress(); // Asumsi ini mengembalikan array
        if (allProgress && allProgress.length > 0) {
          let replyMessage = "📜 *Laporan Progres Harian* 📜\n\n";
          let currentDateFormatted = "";

          allProgress.forEach((progress) => {
            const progressDate = new Date(progress.timestamp);
            const formattedDate = progressDate.toLocaleDateString("id-ID", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            });

            if (currentDateFormatted !== formattedDate) {
              if (currentDateFormatted !== "") replyMessage += "\n";
              replyMessage += `*${formattedDate}*\n`;
              currentDateFormatted = formattedDate;
            }
            replyMessage += `👤 ${progress.sender_name} (${progress.sender_number}):\n`;
            replyMessage += `   ➥ ${progress.progress_message}\n`;
          });
          message.reply(replyMessage);
        } else {
          message.reply("Belum ada progres yang tersimpan. Kosong nih! 💨");
        }
      } catch (error) {
        console.error("Gagal mengambil progres:", error);
        message.reply("Terjadi kesalahan saat mengambil progres. 🙁");
      }
    } else if (body.toLowerCase() === "!help") {
      const helpMessage =
        "🛠 *Daftar Perintah Bot* 🛠\n\n" +
        "• *!ta-progres {pesan}* - Simpan progres harian Anda\n" +
        "• *!check* - Lihat semua progres yang tersimpan\n" +
        "• *!help* - Tampilkan daftar perintah ini\n\n" +
        "Semangat mengerjakan tugas akhir! 💪";
      message.reply(helpMessage);
    }
  }
});

async function sendDailyReminder() {
  console.log(
    `[${new Date().toLocaleString()}] Menjalankan fungsi sendDailyReminder...`
  );
  if (!client || !client.info) {
    console.warn(
      "Pengingat tidak dapat dikirim, klien belum siap atau terputus."
    );
    return;
  }
  try {
    // Cek apakah TARGET_GROUP_ID valid sebelum mencoba mengirim
    if (!CONFIG.TARGET_GROUP_ID || !CONFIG.TARGET_GROUP_ID.endsWith("@g.us")) {
      console.error(
        "TARGET_GROUP_ID tidak valid atau belum diatur. Pengingat tidak akan dikirim."
      );
      return;
    }

    const targetChat = await client.getChatById(CONFIG.TARGET_GROUP_ID);
    if (targetChat) {
      const reminderMessage =
        "🔔 *Pengingat Progres Harian* 🔔\n\n" +
        "Halo tim! 👋 Jangan lupa untuk update progres harian kalian ya.\n\n" +
        "Gunakan format:\n" +
        "`!ta-progres {isi progres Anda}`\n\n" +
        "Untuk melihat semua progres:\n" +
        "`!check-progress`\n\n" +
        "Semangat! 🔥";
      await targetChat.sendMessage(reminderMessage);
      console.log(
        `Pengingat harian terkirim ke grup ${targetChat.name} (${CONFIG.TARGET_GROUP_ID})`
      );
    } else {
      console.warn(
        `Grup dengan ID ${CONFIG.TARGET_GROUP_ID} tidak ditemukan. Pengingat tidak terkirim.`
      );
    }
  } catch (error) {
    console.error("Gagal mengirim pengingat harian:", error);
  }
}

// Inisialisasi Database sebelum memulai client
db.initDb()
  .then(() => {
    console.log("Database berhasil diinisialisasi.");
    console.log(
      `Menginisialisasi klien WhatsApp dengan path sesi: ${CONFIG.WHATSAPP_CLIENT.authStrategy.dataPath}`
    );
    client.initialize().catch((err) => {
      console.error("Gagal inisialisasi klien WhatsApp:", err);
      if (err.message.includes("Could not find browser revision")) {
        console.error(
          "Ini mungkin karena Puppeteer tidak dapat menemukan instalasi Chrome yang kompatibel."
        );
        console.error(
          "Pastikan Chrome atau Chromium terinstal dan CHROME_EXECUTABLE_PATH (jika diatur) sudah benar."
        );
      }
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error("Gagal inisialisasi database:", err);
    process.exit(1);
  });

// Handle Ctrl+C untuk mematikan bot dengan benar
process.on("SIGINT", async () => {
  console.log("Menerima SIGINT (Ctrl+C). Mematikan bot...");
  if (client) {
    try {
      await client.destroy();
      console.log("Klien WhatsApp berhasil dimatikan.");
    } catch (e) {
      console.error("Gagal mematikan klien WhatsApp:", e);
    }
  }
  if (db && typeof db.closeDb === "function") {
    db.closeDb();
    console.log("Koneksi database ditutup.");
  }
  process.exit(0);
});

client.on("disconnected", (reason) => {
  console.log("Client was logged out", reason);
  // Tambahkan logika untuk menangani diskoneksi, misalnya mencoba re-initialize atau keluar
  // Untuk bot yang berjalan lama, Anda mungkin ingin implementasi retry mechanism
  // process.exit(1); // Contoh: keluar jika terputus
});
