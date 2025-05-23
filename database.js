const sqlite3 = require("sqlite3").verbose();
const DB_PATH = "./daily_progress.sqlite"; // Nama file database

let db;

// Fungsi untuk inisialisasi database dan membuat tabel jika belum ada
function initDb() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error("Error opening database", err.message);
        return reject(err);
      }
      console.log("Terhubung ke database SQLite.");
      // Membuat tabel jika belum ada
      db.run(
        `CREATE TABLE IF NOT EXISTS progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_name TEXT NOT NULL,
                sender_number TEXT NOT NULL,
                progress_message TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
        (err) => {
          if (err) {
            console.error("Error creating table", err.message);
            return reject(err);
          }
          console.log('Tabel "progress" siap.');
          resolve();
        }
      );
    });
  });
}

// Fungsi untuk menutup koneksi database
function closeDb() {
  if (db) {
    db.close((err) => {
      if (err) {
        return console.error("Error closing database", err.message);
      }
      console.log("Koneksi database ditutup.");
    });
  }
}

// Fungsi untuk menambahkan progres baru
function addProgress(senderName, senderNumber, progressMessage) {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO progress (sender_name, sender_number, progress_message) VALUES (?, ?, ?)`;
    db.run(sql, [senderName, senderNumber, progressMessage], function (err) {
      // Gunakan function() untuk akses this.lastID
      if (err) {
        console.error("Error inserting progress", err.message);
        return reject(err);
      }
      console.log(`Progres baru ditambahkan dengan ID: ${this.lastID}`);
      resolve(this.lastID);
    });
  });
}

// Fungsi untuk mengambil semua progres, diurutkan berdasarkan tanggal terbaru
function getAllProgress() {
  return new Promise((resolve, reject) => {
    // Mengambil data, diurutkan berdasarkan timestamp (terbaru dulu) lalu nama pengirim
    const sql = `SELECT sender_name, sender_number, progress_message, timestamp FROM progress ORDER BY DATE(timestamp) DESC, timestamp DESC`;
    db.all(sql, [], (err, rows) => {
      if (err) {
        console.error("Error fetching progress", err.message);
        return reject(err);
      }
      resolve(rows);
    });
  });
}

module.exports = {
  initDb,
  closeDb,
  addProgress,
  getAllProgress,
};
