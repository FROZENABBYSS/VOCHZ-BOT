require('dotenv').config();

process.on("unhandledRejection", (err) => {
    console.error("Unhandled Rejection:", err);
});

process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
});

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

// ✅ REPLACED WITH STABLE DB
const Database = require("better-sqlite3");
const db = new Database("./vouches.db");


// ================= DB =================
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS vouches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            giverId TEXT,
            receiverId TEXT,
            reason TEXT,
            messageId TEXT UNIQUE,
            timestamp INTEGER
        )
    `);
});

// ================= CLIENT =================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ================= CONFIG =================
const VOUCH_CHANNEL_ID = "1495408866165264437";

// ================= HELPER =================
function isVouchMessage(content) {
    const text = content.toLowerCase();
    return (
        text.includes('+vouch') ||
        text.includes('+rep') ||
        text.includes('legit') ||
        text.includes('vouch')
    );
}

// ================= COMMANDS =================
const commands = [
    new SlashCommandBuilder()
        .setName('vouches')
        .setDescription('Check vouches of a user')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('User')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Top 10 users'),

    new SlashCommandBuilder()
        .setName('countall')
        .setDescription('Rebuild ALL vouches from channel history')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

// ================= READY =================
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
    );

    console.log('✅ Slash commands registered');
});

// ================= MESSAGE VOUCH =================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!isVouchMessage(message.content)) return;

    const targets = message.mentions.users;
    if (!targets.size) return;

    const isVouchChannel = message.channel.id === VOUCH_CHANNEL_ID;

    for (const user of targets.values()) {

        if (user.id === message.author.id) continue;

        let service = message.content;

        service = service.replace(/\+vouch/gi, '');
        service = service.replace(/\+rep/gi, '');
        service = service.replace(/\blegit\b/gi, '');
        service = service.replace(/\bvouch\b/gi, '');

        targets.forEach(u => {
            service = service.replace(`<@${u.id}>`, '');
            service = service.replace(`<@!${u.id}>`, '');
        });

        service = service.trim();

        if (!service) {
            service = 'No service specified.';
        }

        db.run(
            `INSERT OR IGNORE INTO vouches (giverId, receiverId, reason, messageId, timestamp)
             VALUES (?, ?, ?, ?, ?)`,
            [message.author.id, user.id, service, message.id, Date.now()]
        );

        db.get(
            `SELECT COUNT(*) as total FROM vouches WHERE receiverId = ?`,
            [user.id],
            (err, row) => {

                if (!isVouchChannel) return;

                const now = new Date();
                const time = now.toLocaleTimeString();

                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('⭐ POSITIVE VOUCH')
                    .setDescription(`${message.author} vouched for <@${user.id}>`)
                    .addFields(
                        {
                            name: '📊 Total Vouches',
                            value: `${row?.total || 0}`,
                            inline: false
                        },
                        {
                            name: '📝 Service',
                            value: service.slice(0, 1024),
                            inline: false
                        }
                    )
                    .setFooter({
                        text: `RSL Services 💠 Quality Over Quantity 💠 Today ${time}`
                    })

                message.channel.send({
                    embeds: [embed]
                });
            }
        );
    }
});
// ================= INTERACTIONS =================
client.on('interactionCreate', async interaction => {

    if (!interaction.isChatInputCommand()) return;

    // ================= VOUCHES =================
    if (interaction.commandName === 'vouches') {

        await interaction.deferReply();

        const user = interaction.options.getUser('user') || interaction.user;

        db.get(
            `SELECT COUNT(*) as total FROM vouches WHERE receiverId = ?`,
            [user.id],
            (err, row) => {

                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle(`⭐ ${user.tag}`)
                    .setDescription(`Total Vouches: **${row.total}**`)
                    .setThumbnail(user.displayAvatarURL())
                    .setFooter({
    text: `RSL Services 💠 Quality Over Quantity 💠 Today ${time}`
});
                    
                    

                interaction.editReply({ embeds: [embed] });
            }
        );
    }

    // ================= LEADERBOARD =================
    if (interaction.commandName === 'leaderboard') {

        await interaction.deferReply();

        db.all(
            `
            SELECT receiverId, COUNT(*) as total
            FROM vouches
            GROUP BY receiverId
            ORDER BY total DESC
            LIMIT 10
            `,
            async (err, rows) => {

                let desc = '';

                for (let i = 0; i < rows.length; i++) {
                    const user = await client.users.fetch(rows[i].receiverId).catch(() => null);

                    desc += `**#${i + 1}** ┃ ${user ? user.tag : 'Unknown'}\n` +
                            `⭐ Vouches: **${rows[i].total}**\n\n`;
                }

                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('🏆 VOUCH LEADERBOARD')
                    .setDescription(desc || 'No vouches yet')
                    .setFooter({
                        text: `RSL Services 💠 Quality Over Quantity 💠`
                    })
                    .setTimestamp();

                interaction.editReply({ embeds: [embed] });
            }
        );
    }

    // ================= COUNTALL =================
    if (interaction.commandName === 'countall') {

        await interaction.deferReply({ ephemeral: true });

        const channel = await client.channels.fetch(VOUCH_CHANNEL_ID);

        let lastId = null;
        let processed = 0;

        while (true) {

            const fetched = await channel.messages.fetch({
                limit: 100,
                before: lastId
            });

            if (!fetched.size) break;

            for (const msg of fetched.values()) {

                const targets = msg.mentions.users;
                if (!targets.size) continue;

                for (const user of targets.values()) {

                    if (user.bot) continue;

                    db.run(
                        `INSERT OR IGNORE INTO vouches (giverId, receiverId, reason, messageId, timestamp)
                         VALUES (?, ?, ?, ?, ?)`,
                        [
                            msg.author.id,
                            user.id,
                            msg.content || 'Imported vouch',
                            msg.id,
                            msg.createdTimestamp
                        ]
                    );

                    processed++;
                }
            }

            lastId = fetched.last().id;
        }

        interaction.editReply(`✅ FULL REBUILD COMPLETE\nProcessed **${processed}** vouches.`);
    }
});

// ================= DELETE TRACKING =================
client.on('messageDelete', (message) => {
    db.run(`DELETE FROM vouches WHERE messageId = ?`, [message.id]);
});

// ================= LOGIN =================
client.login(process.env.TOKEN);