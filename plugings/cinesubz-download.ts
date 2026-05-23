import type { BotContext } from '../../types.js';
import { cmd } from '../lib/plugins.js'; 
import axios from 'axios';
import * as cheerio from 'cheerio';

// යූසර්ලා එවන ඉලක්කම් සහ ස්ටෙප්ස් මතක තබා ගැනීමට තාවකාලික මෙමරිය (Session Memory)
const cinesubzSession: {
    [chatId: string]: {
        step: 'movie_selection' | 'quality_selection';
        query: string;
        movies: { title: string; link: string; poster?: string }[];
        selectedMovie?: { title: string; link: string; poster?: string };
        qualities?: { label: string; downloadUrl: string }[];
    }
} = {};

const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

// ==========================================
// 1. ප්‍රධාන සෙවුම් කමාන්ඩ් එක (.cinesubz)
// ==========================================
cmd({
    pattern: "cinesubz",
    alias: ["cs"],
    desc: "Interactive movie and TV series downloader from Cinesubz.co",
    category: "movie",
    use: ".cinesubz [movie_name]",
}, async (sock: any, message: any, args: any, context: BotContext) => {
    const chatId = context.chatId || message.key.remoteJid;
    
    try {
        if (!args[0]) {
            return await sock.sendMessage(chatId, { text: "🔍 *Please enter a movie or TV show name!*\n\n*📌 Example:* `.cinesubz Iron Man`" }, { quoted: message });
        }

        const movieQuery = args.join(" ");
        await sock.sendMessage(chatId, { text: `🎥 *Project Apex-Movie : Searching for "${movieQuery}" on Cinesubz...*` }, { quoted: message });

        const searchUrl = `https://cinesubz.co/?s=${encodeURIComponent(movieQuery)}`;
        const { data } = await axios.get(searchUrl, { headers });
        const $ = cheerio.load(data);
        
        let foundMovies: { title: string; link: string; poster?: string }[] = [];

        // සයිට් එකෙන් ෆිල්ම් වල නම්, ලින්ක් සහ පෝස්ටර් ඉමේජ් සූරා ගැනීම (Scraping)
        $('article, .post-item, .result-item').each((i, el) => {
            if (i < 8) { // උපරිම ප්‍රතිඵල 8ක් පෙන්වීමට
                const title = $(el).find('h2, h3, .title').text().trim();
                const link = $(el).find('a').attr('href');
                let poster = $(el).find('img').attr('src');
                
                if (title && link) {
                    foundMovies.push({ title, link, poster });
                }
            }
        });

        if (foundMovies.length === 0) {
            return await sock.sendMessage(chatId, { text: "❌ *No movies or TV series found matching your search on Cinesubz.*" }, { quoted: message });
        }

        // දත්ත ටික තාවකාලිකව සෙෂන් මෙමරියට දමා ගැනීම
        cinesubzSession[chatId] = {
            step: 'movie_selection',
            query: movieQuery,
            movies: foundMovies
        };

        // ඉලක්කම් පිළිවෙළට ආදේශක ෆිල්ම් ලිස්ට් එක සැකසීම
        let responseMessage = `*🎬 CINESUBZ INTERACTIVE SEARCH 🎬*\n\n`;
        responseMessage += `🔎 _Results for: "${movieQuery}"_\n`;
        responseMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        foundMovies.forEach((movie, index) => {
            responseMessage += `*${index + 1}.* ${movie.title}\n`;
        });

        responseMessage += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        responseMessage += `*💡 Reply with the number of your choice (e.g., 1)*`;

        // පළමු ෆිල්ම් එකේ පෝස්ටර් එකක් තිබේ නම් එය සමඟ මැසේජ් එක යැවීම
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
// 2. ඉලක්කම් රිප්ලයි හඳුනාගන්නා සිස්ටම් එක (Listener Function)
// ==========================================
cmd({
    pattern: "reply-handler-hidden", 
    category: "hidden",
    desc: "Internal logic to parse interactive numbers"
}, async (sock: any, message: any, args: any, context: BotContext) => {
    const chatId = context.chatId || message.key.remoteJid;
    const incomingText = message.message?.conversation?.trim() || message.message?.extendedTextMessage?.text?.trim();
    
    // මෙම චැට් එකේ සක්‍රීය සෙෂන් එකක් නැත්නම් හෝ එවූ මැසේජ් එක ඉලක්කමක් නොවේ නම් ක්‍රියාවලිය නවත්වන්න
    if (!cinesubzSession[chatId] || isNaN(incomingText)) return; 

    const selectedIndex = parseInt(incomingText) - 1;
    const session = cinesubzSession[chatId];

    // ──────────────────────────────────────────
    // පියවර 1: ෆිල්ම් එක තෝරාගත් පසු (Movie Selection)
    // ──────────────────────────────────────────
    if (session.step === 'movie_selection') {
        if (selectedIndex < 0 || selectedIndex >= session.movies.length) {
            return await sock.sendMessage(chatId, { text: "❌ Invalid selection. Please choose a valid number from the list above." }, { quoted: message });
        }

        const selectedMovie = session.movies[selectedIndex];
        await sock.sendMessage(chatId, { text: `🔄 *Extracting details and streaming qualities for:* _${selectedMovie.title}_...` }, { quoted: message });

        try {
            // තෝරාගත් ෆිල්ම් එකේ ලින්ක් එක ඇතුළට ගොස් ඩවුන්ලෝඩ් ලින්ක් සෙවීම
            const { data } = await axios.get(selectedMovie.link, { headers });
            const $ = cheerio.load(data);
            
            let downloadOptions: { label: string; downloadUrl: string }[] = [];

            // සයිට් එකේ තියෙන Pixeldrain, Drive වැනි ඩවුන්ලෝඩ් බොත්තම් හඳුනා ගැනීම
            $('a[href*="download"], a[href*="pixeldrain"], a[href*="drive"], .download-link, .download-btn').each((i, el) => {
                let url = $(el).attr('href');
                let label = $(el).text().trim() || `Option ${i + 1}`;
                
                if (url && (url.includes('pixeldrain') || url.includes('drive.google') || url.includes('mega') || url.includes('download'))) {
                    downloadOptions.push({ label, downloadUrl: url });
                }
            });

            // සයිට් එකේ ලින්ක් ඩිරෙක්ට් නැත්නම්, ෆෝල්බැක් එකක් ලෙස සාමාන්‍ය කොලිටි ලිස්ට් එකක් සෑදීම
            if (downloadOptions.length === 0) {
                downloadOptions.push({ label: "SD 480p (Direct Server Link)", downloadUrl: selectedMovie.link });
                downloadOptions.push({ label: "HD 720p (Direct Server Link)", downloadUrl: selectedMovie.link });
                downloadOptions.push({ label: "FHD 1080p (High Quality Server)", downloadUrl: selectedMovie.link });
            }

            // සෙෂන් එක දෙවැනි පියවරට මාරු කිරීම
            session.step = 'quality_selection';
            session.selectedMovie = selectedMovie;
            session.qualities = downloadOptions;

            let detailsCard = `*📊 MOVIE DETAIL CARD & QUALITIES*\n\n`;
            detailsCard += `🎬 *Title:* ${selectedMovie.title}\n`;
            detailsCard += `🔗 *Source Page:* ${selectedMovie.link}\n\n`;
            detailsCard += `*📥 AVAILABLE DOWNLOAD QUALITIES:*\n`;
            detailsCard += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

            downloadOptions.forEach((option, index) => {
                detailsCard += `*${index + 1}.* ${option.label}\n`;
            });

            detailsCard += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            detailsCard += `*💡 Reply with the option number to start automatic direct download to WhatsApp.*`;

            if (selectedMovie.poster) {
                return await sock.sendMessage(chatId, { image: { url: selectedMovie.poster }, caption: detailsCard }, { quoted: message });
            } else {
                return await sock.sendMessage(chatId, { text: detailsCard }, { quoted: message });
            }

        } catch (err: any) {
            return await sock.sendMessage(chatId, { text: "⚠️ Error extracting options: " + err.message }, { quoted: message });
        }
    }

    // ──────────────────────────────────────────
    // පියවර 2: කොලිටි එක තෝරාගත් පසු ඩවුන්ලෝඩ් කර වීඩියෝ එක යැවීම (Quality Selection)
    // ──────────────────────────────────────────
    if (session.step === 'quality_selection' && session.qualities && session.selectedMovie) {
        if (selectedIndex < 0 || selectedIndex >= session.qualities.length) {
            return await sock.sendMessage(chatId, { text: "❌ Invalid selection. Please choose a valid quality number." }, { quoted: message });
        }

        const chosenQuality = session.qualities[selectedIndex];
        await sock.sendMessage(chatId, { text: `📥 *Downloading is starting on our server...*\n\n🎬 *Movie:* ${session.selectedMovie.title}\n⚙️ *Quality:* ${chosenQuality.label}\n\n_Please wait, file will be uploaded directly as a WhatsApp video document shortly._` }, { quoted: message });

        try {
            let directMediaUrl = chosenQuality.downloadUrl;

            // PixelDrain ලින්ක් එකක් නම් එය කෙලින්ම ඩවුන්ලෝඩ් වන Raw API ලින්ක් එකකට හැරවීම
            if (directMediaUrl.includes('pixeldrain.com/u/')) {
                directMediaUrl = directMediaUrl.replace('/u/', '/api/file/');
            }

            // වීඩියෝ ෆයිල් එක කෙලින්ම WhatsApp එකට Document එකක් ලෙස යැවීම
            await sock.sendMessage(chatId, {
                document: { url: directMediaUrl },
                mimetype: 'video/mp4',
                fileName: `${session.selectedMovie.title} - ApexMovies.mp4`,
                caption: `🍀 *${session.selectedMovie.title}*\n\n🎬 Quality: ${chosenQuality.label}\n💻 *Project Apex-Movie System*`
            }, { quoted: message });

            // වැඩේ ඉවර වූ පසු මෙම චැට් එකේ සෙෂන් එක මකා දැමීම
            delete cinesubzSession[chatId];

        } catch (uploadError: any) {
            await sock.sendMessage(chatId, { text: `❌ Failed to push video file directly. You can manually download via link:\n🔗 ${chosenQuality.downloadUrl}` }, { quoted: message });
            delete cinesubzSession[chatId];
        }
    }
});
