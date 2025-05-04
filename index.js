require("dotenv").config();
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const amqp = require("amqplib");
const fs = require("fs");
const path = require("path");

// Configuration constants
const CONFIG = {
  RABBITMQ: {
    URL: `amqp://${process.env.RABBITMQ_USERNAME || "shopeeweb"}:${
      process.env.RABBITMQ_PASSWORD || "shopeeweb"
    }@${process.env.RABBITMQ_HOST || "127.0.0.1"}`,
    QUEUE_NAME: process.env.QUEUE_NAME || "whatsapp_messages",
    RECONNECT_TIMEOUT: parseInt(process.env.RECONNECT_TIMEOUT || "5000"),
  },
  WHATSAPP_CLIENT: {
    authStrategy: new LocalAuth({
      dataPath: "./.wwebjs_auth",
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath:
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    },
  },
  GROUPS_FILE_PATH: path.join(__dirname, "whatsapp_groups.json"),
};

/**
 * Class for handling WhatsApp messaging functionality
 */
class WhatsAppClient {
  static instance = null;
  client = null;

  constructor() {
    this.client = new Client(CONFIG.WHATSAPP_CLIENT);
    WhatsAppClient.instance = this;
    this.initializeEvents();
  }

  /**
   * Initialize WhatsApp client event listeners
   */
  initializeEvents() {
    this.client.on("qr", this.handleQR);
    this.client.on("ready", this.handleReady.bind(this));
    this.client.on("disconnected", this.handleDisconnected);
    this.client.initialize();
  }

  /**
   * Handle QR code generation for authentication
   * @param {string} qr - QR code data
   */
  handleQR(qr) {
    console.log("QR Code received, please scan:");
    qrcode.generate(qr, { small: true });
  }

  /**
   * Handle client ready event
   */
  async handleReady() {
    console.log("WhatsApp client ready");
    await this.saveGroupList();
  }

  /**
   * Handle client disconnection
   * @param {string} reason - Disconnection reason
   */
  handleDisconnected(reason) {
    console.log("WhatsApp client disconnected:", reason);
  }

  /**
   * Save list of WhatsApp groups to file
   */
  async saveGroupList() {
    try {
      console.log("Fetching WhatsApp groups...");
      const chats = await this.client.getChats();
      const groups = chats.filter((chat) => chat.isGroup);

      const groupList = groups.map((group) => ({
        id: group.id._serialized,
        name: group.name,
        participants: group.participants.length,
      }));

      fs.writeFileSync(
        CONFIG.GROUPS_FILE_PATH,
        JSON.stringify(groupList, null, 2)
      );

      console.log(
        `${groupList.length} WhatsApp groups saved to ${CONFIG.GROUPS_FILE_PATH}`
      );
    } catch (error) {
      console.error("Error saving group list:", error);
    }
  }

  /**
   * Send message to WhatsApp number
   * @param {string} number - Recipient number
   * @param {string} text - Message text
   * @param {string|null} image - Base64 encoded image
   */
  async sendMessage(number, text, image = null) {
    const formattedNumber = this.formatPhoneNumber(number);

    if (image) {
      await this.sendMediaMessage(formattedNumber, text, image);
    } else {
      await this.client.sendMessage(formattedNumber, text);
      console.log(`Message sent to ${formattedNumber}: ${text}`);
    }
  }

  /**
   * Send media message with caption
   * @param {string} number - Recipient number
   * @param {string} caption - Message caption
   * @param {string} imageData - Base64 encoded image
   */
  async sendMediaMessage(number, caption, imageData) {
    if (!this.isValidBase64Image(imageData)) {
      throw new Error("Invalid base64 format");
    }

    const media = this.createMessageMedia(imageData);
    await this.client.sendMessage(number, media, { caption });
    console.log(`Media message sent to ${number}`);
  }

  /**
   * Format phone number to WhatsApp format
   * @param {string} number - Phone number
   * @returns {string} Formatted number
   */
  formatPhoneNumber(number) {
    if (number.includes("@c.us") || number.includes("@g.us")) {
      return number;
    }
    return `${number.replace(/[^0-9]/g, "")}@c.us`;
  }

  /**
   * Validate if string is a valid base64 image
   * @param {string} image - Base64 image string
   * @returns {boolean} Is valid
   */
  isValidBase64Image(image) {
    return image.match(/^data:image\/(jpeg|png|gif);base64,/);
  }

  /**
   * Create MessageMedia object from base64 data
   * @param {string} imageData - Base64 image data
   * @returns {MessageMedia} Message media object
   */
  createMessageMedia(imageData) {
    const mimeType = imageData.split(";")[0].split(":")[1];
    const base64Data = imageData.split(",")[1];
    return new MessageMedia(mimeType, base64Data);
  }
}

/**
 * Class for handling RabbitMQ messaging
 */
class MessageQueue {
  whatsAppClient = null;

  /**
   * @param {WhatsAppClient} whatsAppClient - WhatsApp client instance
   */
  constructor(whatsAppClient) {
    this.whatsAppClient = whatsAppClient;
    this.initialize();
  }

  /**
   * Initialize RabbitMQ connection
   */
  async initialize() {
    try {
      const connection = await amqp.connect(CONFIG.RABBITMQ.URL);
      const channel = await connection.createChannel();
      await channel.assertQueue(CONFIG.RABBITMQ.QUEUE_NAME);

      console.log("Connected to RabbitMQ, waiting for messages...");
      this.consumeMessages(channel);
    } catch (error) {
      console.error("Error connecting to RabbitMQ:", error);
      setTimeout(() => this.initialize(), CONFIG.RABBITMQ.RECONNECT_TIMEOUT);
    }
  }

  /**
   * Consume messages from RabbitMQ queue
   * @param {Object} channel - RabbitMQ channel
   */
  async consumeMessages(channel) {
    channel.consume(
      CONFIG.RABBITMQ.QUEUE_NAME,
      async (data) => {
        if (data) {
          try {
            console.log(
              "Received message from RabbitMQ:",
              data.content.toString()
            );

            // Acknowledge message immediately
            channel.ack(data);

            // Process message
            const message = JSON.parse(data.content);
            console.log("Received message:", message);

            // Validate message format
            if (!message.wa_number) {
              console.error("Invalid message format: wa_number not found");
              return;
            }

            const { wa_number, text, image } = message;

            // Send WhatsApp message
            try {
              await this.whatsAppClient.sendMessage(
                wa_number,
                text || "",
                image || null
              );
              console.log(`Message successfully sent to ${wa_number}`);
            } catch (sendError) {
              console.error("Error sending WhatsApp message:", sendError);
            }
          } catch (error) {
            console.error("Error processing message:", error);
            // Message already acknowledged at the beginning
          }
        }
      },
      {
        // Additional consumer configuration
        noAck: false, // Ensure manual acknowledgment is enabled
      }
    );

    console.log(
      `RabbitMQ consumer active and waiting for messages in queue ${CONFIG.RABBITMQ.QUEUE_NAME}`
    );
  }
}

/**
 * Main application class
 */
class Application {
  static async start() {
    // Initialize WhatsApp client
    const whatsAppClient = new WhatsAppClient();

    // Wait for WhatsApp client to be ready
    whatsAppClient.client.on("ready", () => {
      // Initialize message queue after WhatsApp is ready
      new MessageQueue(whatsAppClient);
    });
  }
}

// Start the application
Application.start();
