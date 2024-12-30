const { Telegraf, Markup } = require('telegraf');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// Set ffmpeg and ffprobe paths
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

// Telegram Bot Token
const BOT_TOKEN = '7603494053:AAHhpqQKLItdNFPoOGI-oq2ZMsDGfQ0-KrM';
const bot = new Telegraf(BOT_TOKEN);

// Directory to store the audio files temporarily
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

// Store session data
let sessions = {};

// Check if the user has joined the channel
async function checkChannelMembership(ctx, userId) {
  const channelUsername = '@awt_bots';
  try {
    const chatMember = await ctx.telegram.getChatMember(channelUsername, userId);
    return ['member', 'administrator', 'creator'].includes(chatMember.status);
  } catch (error) {
    console.error('Error checking channel membership:', error);
    return false;
  }
}

// Function to clean up files
function cleanUpFiles(session) {
  session.audioFiles.forEach((file) => {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  });
  const combinedPath = path.join(DOWNLOAD_DIR, 'combined.mp3');
  if (fs.existsSync(combinedPath)) fs.unlinkSync(combinedPath);
  session.audioFiles = [];
  session.totalAudioFiles = 0;
}

// Function to handle combining audio files
async function combineAudioFiles(ctx, session) {
  const outputPath = path.join(DOWNLOAD_DIR, 'combined.mp3');
  const ffmpegProcess = ffmpeg();

  session.audioFiles.forEach((file) => ffmpegProcess.input(file));

  // Notify user about processing
  const processingMessage = await ctx.reply('Processing your audio files...');

  ffmpegProcess
    .on('end', async () => {
      try {
        // Send the combined audio file
        await ctx.replyWithAudio(
          { source: outputPath },
          { caption: 'Audio Combined By @awt_bots' }
        );

        // Clean up the messages and files
        await ctx.deleteMessage(processingMessage.message_id);
        cleanUpFiles(session);
      } catch (error) {
        console.error('Error sending combined audio:', error);
        await ctx.reply('An error occurred while sending the combined audio file.');
      }
    })
    .on('error', (err) => {
      console.error('Error combining audios:', err);
      ctx.reply('An error occurred while combining the audios.');
    })
    .mergeToFile(outputPath);
}

// Start command to reset session
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  if (!sessions[userId]) {
    sessions[userId] = { audioFiles: [], totalAudioFiles: 0, isMember: false };
  }

  const isMember = await checkChannelMembership(ctx, userId);
  sessions[userId].isMember = isMember;

  if (!isMember) {
    // Ask the user to join the channel
    await ctx.reply(
      'Welcome! Please join our channel to use this bot.',
      Markup.inlineKeyboard([
        Markup.button.url('Join @awt_bots', 'https://t.me/awt_bots'),
        Markup.button.callback('I have joined', 'joined_channel'),
      ])
    );
  } else {
    // Proceed to ask for audio file length
    await ctx.reply('Welcome! Please specify the total number of audio files you want to combine:');
  }
});

// Handle "I have joined" button
bot.action('joined_channel', async (ctx) => {
  const userId = ctx.from.id;

  const isMember = await checkChannelMembership(ctx, userId);
  if (isMember) {
    sessions[userId].isMember = true;
    await ctx.editMessageText('Thank you for joining! Please specify the total number of audio files you want to combine:');
  } else {
    await ctx.reply('You need to join @awt_bots to use this bot.');
  }
});

// Handle user input for total number of audio files
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = sessions[userId];

  if (!session || !session.isMember) {
    await ctx.reply('Please join @awt_bots and click "I have joined" to proceed.');
    return;
  }

  if (!session.totalAudioFiles) {
    const input = parseInt(ctx.message.text, 10);
    if (isNaN(input) || input <= 0) {
      await ctx.reply('Please send a valid number for the total audio files.');
    } else {
      session.totalAudioFiles = input;
      await ctx.reply(`You can now upload ${session.totalAudioFiles} audio files.`);
    }
  } else {
    await ctx.reply('You are already uploading audio files. Please continue.');
  }
});

// Handle audio messages
bot.on('audio', async (ctx) => {
  const userId = ctx.from.id;
  const session = sessions[userId];

  if (!session || !session.totalAudioFiles) {
    await ctx.reply('Please specify the total number of audio files first.');
    return;
  }

  try {
    // Get the audio file details
    const fileId = ctx.message.audio.file_id;
    const fileUrl = await ctx.telegram.getFileLink(fileId);

    // Define a temporary path for the audio file
    const audioPath = path.join(DOWNLOAD_DIR, `${fileId}.mp3`);

    // Download the audio file
    const response = await axios({
      url: fileUrl.href,
      method: 'GET',
      responseType: 'stream',
    });

    const audioStream = fs.createWriteStream(audioPath);
    response.data.pipe(audioStream);

    audioStream.on('finish', async () => {
      session.audioFiles.push(audioPath);

      if (session.audioFiles.length === session.totalAudioFiles) {
        await combineAudioFiles(ctx, session);
      } else {
        await ctx.reply(
          `You have uploaded ${session.audioFiles.length} audio files. Upload ${session.totalAudioFiles - session.audioFiles.length} more to combine.`
        );
      }
    });

    audioStream.on('error', (err) => {
      console.error('Error downloading audio:', err);
      ctx.reply('Failed to download the audio. Please try again.');
    });
  } catch (error) {
    console.error('Error handling audio:', error);
    ctx.reply('An error occurred while processing your audio.');
  }
});

// Launch the bot
bot.launch().then(() => {
  console.log('Bot is running...');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
