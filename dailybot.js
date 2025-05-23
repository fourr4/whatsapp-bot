const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const db = require("./database"); // Kita akan buat file ini nanti

// Inisialisasi Grup ID Target (Ganti dengan ID grup Anda)
// Cara mendapatkan Group ID: Anda bisa log pesan yang masuk dari grup tersebut
// dan lihat `message.from` atau `chat.id._serialized`
const TARGET_GROUP_ID = "GROUP_ID_ANDA@g.us"; // Contoh: 120363047856000000@g.us

const client = new Client({
  authStrategy: new LocalAuth(), // Menggunakan LocalAuth untuk menyimpan sesi
  puppeteer: {
    // headless: false, // Set true untuk menjalankan tanpa browser UI
    args: ["--no-sandbox", "--disable-setuid-sandbox"], // Diperlukan untuk beberapa lingkungan Linux
  },
});

client.on("qr", (qr) => {
  console.log("QR Diterima, pindai dengan WhatsApp Anda:");
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
  console.log("Terautentikasi!");
});

client.on("auth_failure", (msg) => {
  console.error("Autentikasi GAGAL:", msg);
});

client.on("ready", () => {
  console.log("Bot Siap!");
  // Kirim pengingat harian (Contoh: setiap jam 9 pagi)
  // Anda bisa menggunakan library seperti 'node-cron' untuk penjadwalan yang lebih advance
  sendDailyReminder(); // Panggil sekali saat ready, atau atur dengan cron
});

client.on("message", async (message) => {
  const chat = await message.getChat();
  const sender = await message.getContact();
  const senderName = sender.pushname || sender.name || sender.number; // Dapatkan nama pengirim
  const senderNumber = sender.id.user; // Nomor pengirim tanpa @c.us

  // Hanya proses pesan dari grup target dan bukan dari bot itu sendiri
  if (
    chat.isGroup &&
    chat.id._serialized === TARGET_GROUP_ID &&
    !message.fromMe
  ) {
    console.log(
      `Pesan dari [${senderName} (${senderNumber})] di grup [${chat.name}]: ${message.body}`
    );

    const body = message.body.trim();

    if (body.startsWith("!ta-progres ")) {
      const progressMessage = body.substring("!ta-progres ".length).trim();
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
    } else if (body === "!check-progress") {
      try {
        const allProgress = await db.getAllProgress();
        if (allProgress.length > 0) {
          let replyMessage = "📜 *Laporan Progres Harian* 📜\n\n";
          let currentDate = "";

          allProgress.forEach((progress) => {
            // Format tanggal menjadi DD MMMM YYYY
            const progressDate = new Date(
              progress.timestamp
            ).toLocaleDateString("id-ID", {
              day: "numeric",
              month: "long",
              year: "numeric",
            });

            if (currentDate !== progressDate) {
              if (currentDate !== "") replyMessage += "\n"; // Tambah spasi antar tanggal
              replyMessage += `*${progressDate}*\n`;
              currentDate = progressDate;
            }
            replyMessage += `👤 ${progress.sender_name} (${progress.sender_number}):\n`;
            replyMessage += `   ➥ ${progress.progress_message}\n`;
          });
          message.reply(replyMessage);
        } else {
          message.reply("Belum ada progres yang tersimpan!");
        }
      } catch (error) {
        console.error("Gagal mengambil progres:", error);
        message.reply("Terjadi kesalahan saat mengambil progres. 🙁");
      }
    }
  }
});

async function sendDailyReminder() {
  console.log("Mencoba mengirim pengingat harian...");
  try {
    const targetChat = await client.getChatById(TARGET_GROUP_ID);
    if (targetChat) {
      await targetChat.sendMessage(
        "🔔 *Pengingat Progres Harian* 🔔\n\n" +
          "Halo tim! 👋 Jangan lupa untuk update progres harian kalian ya.\n\n" +
          "Gunakan format:\n" +
          "`!ta-progres {isi progres Anda}`\n\n" +
          "Untuk melihat semua progres:\n" +
          "`!check-progress`\n\n" +
          "Semangat! 🔥"
      );
      console.log(`Pengingat harian terkirim ke grup ${targetChat.name}`);
    } else {
      console.warn(`Grup dengan ID ${TARGET_GROUP_ID} tidak ditemukan.`);
    }
  } catch (error) {
    console.error("Gagal mengirim pengingat harian:", error);
  }

  // Jadwalkan pengingat berikutnya (Contoh: setiap 24 jam)
  // Untuk penjadwalan yang lebih baik, gunakan node-cron
  // setTimeout(sendDailyReminder, 24 * 60 * 60 * 1000); // 24 jam
}

// Inisialisasi Database sebelum memulai client
db.initDb()
  .then(() => {
    client.initialize();
  })
  .catch((err) => {
    console.error("Gagal inisialisasi database:", err);
    process.exit(1); // Keluar jika DB gagal
  });

// Handle Ctrl+C untuk mematikan bot dengan benar
process.on("SIGINT", async () => {
  console.log("Mematikan bot...");
  await client.destroy();
  db.closeDb();
  process.exit(0);
});
