import type { BotContext } from '../../types.js';
import { cmd } from '../lib/plugins.js'; 
import axios from 'axios';
import * as cheerio from 'cheerio';

// සින්හලසබ් සෙෂන් මතක තබා ගැනීමට තාවකාලික මෙමරිය
const sinhalasubSession: {
    [chatId: string]: {
        step: 'movie_selection' | 'quality_selection';
        query: string;
        movies: { title: string; link: string; poster?: string }[];
        selectedMovie?: { title: string; link: string; poster?: string };
        qualities?: { label: string; downloadUrl: string; isSub?: boolean }[];
    }
} = {};

const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

// ==========================================
// 1. ප්‍රධාන සෙවුම් කමාන්ඩ් එක (.sinhalasub)
// ==========================================
cmd({
    pattern: "sinhalasub",
    alias: ["ssub", "ss"],
    desc: "Interactive movie & series downloader from Sinhalasub.lk",
    category: "movie",
    use: ".sinhalasub [movie_name]",
}, async (sock: any, message: any, args: any, context: BotContext) => {
    const chatId = context.chatId || message.key.remoteJid;
    
    try {
        if (!args[0]) {
            return await sock.sendMessage(chatId, { text: "🔍 *Please enter a movie or TV show name!*\n\n*📌 Example:* `.sinhalasub Avatar`" }, { quoted: message });
        }

        const movieQuery = args.join(" ");
        await sock.sendMessage(chatId, { text: `🎥 *Project Apex-Movie : Searching for "${movieQuery}" on Sinhalasub...*` }, { quoted: message });

        // Sinhalasub සයිට් එකේ සර්ච් යූආර්එල් එක
        const searchUrl = `https://sinhalasub.lk/?s=${encodeURIComponent(movieQuery)}`;
        const { data } = await axios.get(searchUrl, { headers });
        const $ = cheerio.load(data);
        
        let foundMovies: { title: string; link: string; poster?: string }[] = [];

        // සයිට් එකේ ව්‍යුහයට අනුව දත්ත සූරා ගැනීම
        $('.result-item, article, .post-box').each((i, el) => {
            if (i < 8) {
                const title = $(el).find('.title a, h2 a, h3 a').text().trim() || $(el).find('img').attr('alt')?.trim();
                const link = $(el).find('a').attr('href');
                let poster = $(el).find('img').attr('src');
                
                if (title && link) {
                    foundMovies.push({ title, link, poster });
                }
            }
        });

        if (foundMovies.length === 0) {
            return await sock.sendMessage(chatId, { text: "❌ *No movies or TV series found matching your search on Sinhalasub.*" }, { quoted: message });
        }

        sinhalasubSession[chatId] = {
            step: 'movie_selection',
            query: movieQuery,
            movies: foundMovies
        };

        let responseMessage = `*🎬 SINHALASUB INTERACTIVE SEARCH 🎬*\n\n`;
        responseMessage += `🔎 _Results for: "${movieQuery}"_\n`;
        responseMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        foundMovies.forEach((movie, index) => {
            responseMessage += `*${index + 1}.* ${movie.title}\n`;
        });

        responseMessage += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        responseMessage += `*💡 Reply with the number of your choice (e.g., 1)*`;

        const primePoster = foundMovies[0].poster;
        if (primePoster && (primePoster.startsWith('http://') || primePoster.startsWith('https://'))) {
            return await sock.sendMessage(chatId, {
                image: { url: primePoster },
                caption: responseMessage
            }, { quoted: message });
        } else {
            return await sock.sendMessage(chatId, { text: responseMessage }, { quoted: message });
        }

    } catch (error: any) {
        await sock.sendMessage(chatId, { text: "⚠️ System Error: " + error.message }, { quoted: message });
    }
});

// ==========================================
// 2. ඉලක්කම් රිප්ලයි හඳුනාගන්නා සිස්ටම් එක (Listener)
// ==========================================
cmd({
    pattern: "reply-handler-ssub", 
    category: "hidden",
    desc: "Internal logic to parse Sinhalasub numbers"
}, async (sock: any, message: any, args: any, context: BotContext) => {
    const chatId = context.chatId || message.key.remoteJid;
    const incomingText = message.message?.conversation?.trim() || message.message?.extendedTextMessage?.text?.trim();
    
    if (!sinhalasubSession[chatId] || isNaN(incomingText)) return; 

    const selectedIndex = parseInt(incomingText) - 1;
    const session = sinhalasubSession[chatId];

    // පියවර 1: ෆිල්ම් එක තෝරාගත් පසු
    if (session.step === 'movie_selection') {
        if (selectedIndex < 0 || selectedIndex >= session.movies.length) {
            return await sock.sendMessage(chatId, { text: "❌ Invalid selection. Please choose a valid number." }, { quoted: message });
        }

        const selectedMovie = session.movies[selectedIndex];
        await sock.sendMessage(chatId, { text: `🔄 *Extracting movie links & Sinhala subtitles for:* _${selectedMovie.title}_...` }, { quoted: message });

        try {
            const { data } = await axios.get(selectedMovie.link, { headers });
            const $ = cheerio.load(data);
            
            let downloadOptions: { label: string; downloadUrl: string; isSub?: boolean }[] = [];

            // 🇱🇰 සිංහල සබ්ෆයිල් ලින්ක් එක සූරා ගැනීම
            $('a[href*="sub"], a[href*="srt"], a[href*="mediafire.com"]').each((i, el) => {
                let url = $(el).attr('href');
                if (url && (url.includes('mediafire') || url.includes('sub'))) {
                    // දැනටමත් සබ් එක ඇතුළත් වී ඇත්නම් නැවත දැමීම වැළැක්වීමට
                    if (!downloadOptions.some(opt => opt.isSub)) {
                        downloadOptions.push({ label: "🇱🇰 Download Sinhala Subtitle Only (.SRT)", downloadUrl: url, isSub: true });
                    }
                }
            });

            // Pixeldrain, Mega හෝ Direct ඩවුන්ලෝඩ් වීඩියෝ ලින්ක් සූරා ගැනීම
            $('a[href*="pixeldrain"], a[href*="mega"], a[href*="download"], .download-btn').each((i, el) => {
                let url = $(el).attr('href');
                let label = $(el).text().trim() || `Option ${i + 1}`;
                
                if (url && (url.includes('pixeldrain') || url.includes('mega') || url.includes('download'))) {
                    if (!url.includes('mediafire.com')) {
                        downloadOptions.push({ label: `🎥 Video Quality: ${label.replace(/[\n\t]/g, '')}`, downloadUrl: url, isSub: false });
                    }
                }
            });

            // ෆෝල්බැක් ලින්ක්ස් (ලින්ක්ස් සයිට් එකේ කෙලින්ම නැත්නම්)
            if (downloadOptions.length === 0 || (downloadOptions.length === 1 && downloadOptions[0].isSub)) {
                downloadOptions.push({ label: "🎥 Video Quality: SD 480p (Direct Link)", downloadUrl: selectedMovie.link, isSub: false });
                downloadOptions.push({ label: "🎥 Video Quality: HD 720p (Direct Link)", downloadUrl: selectedMovie.link, isSub: false });
            }

            session.step = 'quality_selection';
            session.selectedMovie = selectedMovie;
            session.qualities = downloadOptions;

            let detailsCard = `*📊 SINHALASUB MOVIE CARD & OPTIONS*\n\n`;
            detailsCard += `🎬 *Title:* ${selectedMovie.title}\n`;
            detailsCard += `🔗 *Source Page:* ${selectedMovie.link}\n\n`;
            detailsCard += `*📥 AVAILABLE OPTIONS (REPLY WITH NUMBER):*\n`;
            detailsCard += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

            downloadOptions.forEach((option, index) => {
                detailsCard += `*${index + 1}.* ${option.label}\n`;
            });

            detailsCard += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            detailsCard += `*💡 Reply with the option number to download directly to WhatsApp.*`;

            if (selectedMovie.poster) {
                return await sock.sendMessage(chatId, { image: { url: selectedMovie.poster }, caption: detailsCard }, { quoted: message });
            } else {
                return await sock.sendMessage(chatId, { text: detailsCard }, { quoted: message });
            }

        } catch (err: any) {
            return await sock.sendMessage(chatId, { text: "⚠️ Error extracting options: " + err.message }, { quoted: message });
        }
    }

    // පියවර 2: කොලිටි/සබ් තෝරාගත් පසු ඩවුන්ලෝඩ් කර යැවීම
    if (session.step === 'quality_selection' && session.qualities && session.selectedMovie) {
        if (selectedIndex < 0 || selectedIndex >= session.qualities.length) {
            return await sock.sendMessage(chatId, { text: "❌ Invalid selection. Please choose a valid option number." }, { quoted: message });
        }

        const chosenOption = session.qualities[selectedIndex];
        
        // සබ්ෆයිල් යැවීම
        if (chosenOption.isSub) {
            await sock.sendMessage(chatId, { text: `📥 *Downloading Sinhalasub Subtitle file...*\n\n🎬 *Movie:* ${session.selectedMovie.title}` }, { quoted: message });
            try {
                await sock.sendMessage(chatId, {
                    document: { url: chosenOption.downloadUrl },
                    mimetype: 'application/x-zip-compressed',
                    fileName: `[Sinhalasub]_${session.selectedMovie.title}.zip`,
                    caption: `🇱🇰 *Sinhala Subtitle Successfully Downloaded!*\n\n🎬 *Movie:* ${session.selectedMovie.title}\n💻 *Project Apex-Movie System*`
                }, { quoted: message });
                delete sinhalasubSession[chatId];
                return;
            } catch {
                return await sock.sendMessage(chatId, { text: `❌ Failed to download subtitle directly. Link:\n🔗 ${chosenOption.downloadUrl}` }, { quoted: message });
            }
        }

        // වීඩියෝ ෆයිල් යැවීම
        await sock.sendMessage(chatId, { text: `📥 *Downloading video file from Sinhalasub server...*\n\n🎬 *Movie:* ${session.selectedMovie.title}\n⚙️ *Quality:* ${chosenOption.label}\n\n_Please wait, video document is uploading to WhatsApp..._` }, { quoted: message });

        try {
            let directMediaUrl = chosenOption.downloadUrl;

            if (directMediaUrl.includes('pixeldrain.com/u/')) {
                directMediaUrl = directMediaUrl.replace('/u/', '/api/file/');
            }

            await sock.sendMessage(chatId, {
                document: { url: directMediaUrl },
                mimetype: 'video/mp4',
                fileName: `${session.selectedMovie.title} - Sinhalasub.mp4`,
                caption: `🍀 *${session.selectedMovie.title}*\n\n🎬 Quality: ${chosenOption.label}\n💻 *Project Apex-Movie System*`
            }, { quoted: message });

            delete sinhalasubSession[chatId];

        } catch (uploadError: any) {
            await sock.sendMessage(chatId, { text: `❌ Failed to push video file directly. Link:\n🔗 ${chosenOption.downloadUrl}` }, { quoted: message });
            delete sinhalasubSession[chatId];
        }
    }
});
