require("dotenv").config();
const amqp = require("amqplib");
const fs = require("fs");

// Konfigurasi RabbitMQ
const CONFIG = {
  RABBITMQ: {
    URL: `amqp://${process.env.RABBITMQ_USERNAME || "shopeeweb"}:${
      process.env.RABBITMQ_PASSWORD || "shopeeweb"
    }@${process.env.RABBITMQ_HOST || "127.0.0.1"}`,
    QUEUE_NAME: process.env.QUEUE_NAME || "whatsapp_messages",
  },
};

// Fungsi untuk membaca file gambar dan mengkonversi ke base64
function imageToBase64(filePath) {
  try {
    // Baca file gambar
    const fileData = fs.readFileSync(filePath);

    // Deteksi tipe MIME berdasarkan ekstensi file
    let mimeType = "image/jpeg"; // Default MIME type
    if (filePath.endsWith(".png")) {
      mimeType = "image/png";
    } else if (filePath.endsWith(".gif")) {
      mimeType = "image/gif";
    }

    // Konversi ke base64 dan tambahkan prefix data URL
    const base64Data = fileData.toString("base64");
    return `data:${mimeType};base64,${base64Data}`;
  } catch (error) {
    console.error("Error saat mengkonversi gambar ke base64:", error);
    return null;
  }
}

// Fungsi untuk mengirim pesan ke RabbitMQ
async function sendMessageToQueue(message) {
  try {
    // Buat koneksi ke RabbitMQ
    const connection = await amqp.connect(CONFIG.RABBITMQ.URL);
    const channel = await connection.createChannel();

    // Pastikan queue sudah ada
    await channel.assertQueue(CONFIG.RABBITMQ.QUEUE_NAME);

    // Kirim pesan ke queue
    const success = channel.sendToQueue(
      CONFIG.RABBITMQ.QUEUE_NAME,
      Buffer.from(JSON.stringify(message))
    );

    console.log("Pesan berhasil dikirim ke RabbitMQ:", success);

    // Tutup koneksi setelah selesai
    setTimeout(() => {
      connection.close();
      console.log("Koneksi RabbitMQ ditutup");
    }, 500);

    return success;
  } catch (error) {
    console.error("Error saat mengirim pesan ke RabbitMQ:", error);
    return false;
  }
}

// Contoh penggunaan
async function main() {
  // Path ke file gambar (ganti dengan path file gambar Anda)
  const imagePath = "./motor.jpeg"; // Sesuaikan dengan path gambar Anda

  // Konversi gambar ke base64
  const imageBase64 = imageToBase64(imagePath);

  // Buat pesan untuk dikirim ke grup WhatsApp
  // const message = {
  //   wa_number: "120363418805481164@g.us", // ID grup WhatsApp
  //   text: "test12233", // Teks pesan
  //   image: imageBase64, // Data gambar dalam format base64
  // };

  const message = {
    wa_number: "6289523804019",
    text: "gilammahallllll", // Teks pesan
    image: imageBase64, // Data gambar dalam format base64
  };

  // Kirim pesan ke RabbitMQ
  await sendMessageToQueue(message);
}

// Jalankan fungsi utama
main().catch(console.error);
