import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    CommandInteraction,
    Interaction,
    InteractionReplyOptions,
    Message,
    MessageActionRowComponentBuilder,
    MessageOptions,
    SelectMenuBuilder,
    SelectMenuOptionBuilder,
} from "discord.js";
import { inPlaceSort } from "fast-sort";
import { addCooldown, getResponse, onCooldown } from "../utils/cooldownhandler.js";
import { addProgress } from "../utils/economy/achievements.js";
import { createUser, getBalance, getInventory, setInventory, updateBalance, userExists } from "../utils/economy/utils.js";
import { addToNypsiBank, getNypsiBankBalance, removeFromNypsiBankBalance } from "../utils/functions/tax.js";
import { Categories, Command, NypsiCommandInteraction } from "../utils/models/Command";
import { CustomEmbed, ErrorEmbed } from "../utils/models/EmbedBuilders.js";
import ms = require("ms");

const cmd = new Command("bankrob", "attempt to rob a bank for a high reward", Categories.MONEY);

const bankWorths = new Map<string, { banks: Map<string, number>; createdAt: number }>();

const defaults = new Map<string, number>([
    ["bank of america", 10_000_000],
    ["maze bank", 5_000_000],
    ["barclays", 2_500_000],
    ["lloyds", 1_250_000],
    ["monzo", 1_000_000],
    ["fleeca", 750_000],
]);

cmd.slashEnabled = true;

async function run(message: Message | (NypsiCommandInteraction & CommandInteraction)) {
    if (!(await userExists(message.member))) await createUser(message.member);

    const send = async (data: MessageOptions | InteractionReplyOptions) => {
        if (!(message instanceof Message)) {
            if (message.deferred) {
                await message.editReply(data);
            } else {
                await message.reply(data as InteractionReplyOptions);
            }
            const replyMsg = await message.fetchReply();
            if (replyMsg instanceof Message) {
                return replyMsg;
            }
        } else {
            return await message.channel.send(data as MessageOptions);
        }
    };

    if ((await getBalance(message.member)) < 5_000) {
        return send({ embeds: [new ErrorEmbed("you must have atleast $5k")], ephemeral: true });
    }

    const getMaxValues = async (bankBalance: number) => {
        const balance = await getBalance(message.member);
        const inventory = await getInventory(message.member);

        let maxLoss = balance * 0.63;
        let maxSteal = balance * 0.5;

        if (maxLoss > bankBalance * 0.6) {
            maxLoss = bankBalance * 0.7;
            maxSteal = bankBalance * 0.5;
        } else if (maxSteal < 100_000) {
            maxSteal = 100_000;
            maxLoss = balance * 0.95;
        }

        let lawyer = false;

        if (inventory["lawyer"] && inventory["lawyer"] > 0) {
            lawyer = true;
            maxLoss = maxLoss * 0.35;
        }

        return { loss: Math.floor(maxLoss), steal: Math.floor(maxSteal), lawyer };
    };

    const displayBankInfo = async (bank: string, bankWorth: Map<string, number>) => {
        let loss: number;
        let steal: number;
        let lawyer: boolean;

        let worth: number;

        if (bank == "nypsi") {
            worth = await getNypsiBankBalance();
            const res = await getMaxValues(worth);

            loss = res.loss;
            steal = res.steal;
            lawyer = res.lawyer;
        } else {
            worth = bankWorth.get(bank);
            const res = await getMaxValues(bankWorth.get(bank));

            loss = res.loss;
            steal = res.steal;
            lawyer = res.lawyer;
        }

        return `**${bank}**\n*$${worth.toLocaleString()}*\n\n**max steal** $${steal.toLocaleString()}\n**max loss** $${loss.toLocaleString()}${
            lawyer ? " 🧑‍⚖️" : ""
        }${(await onCooldown(cmd.name, message.member)) ? "\n\ncurrently on cooldown" : ""}`;
    };

    const robBank = async (bank: string, bankWorth: Map<string, number>) => {
        if (await onCooldown(cmd.name, message.member)) {
            const embed = await getResponse(cmd.name, message.member);

            if (message instanceof Message) {
                message.channel.send({ embeds: [embed] });
                return;
            } else {
                message.followUp({ embeds: [embed] });
                return;
            }
        }

        if ((await getBalance(message.member)) < 5_000) {
            if (message instanceof Message) {
                message.channel.send({ embeds: [new ErrorEmbed("you must have atleast $5k")] });
                return;
            } else {
                message.followUp({ embeds: [new ErrorEmbed("you must have atleast $5k")] });
                return;
            }
        }

        await addCooldown(cmd.name, message.member, 900);

        let loss: number;
        let steal: number;

        if (bank == "nypsi") {
            const res = await getMaxValues(await getNypsiBankBalance());

            loss = res.loss;
            steal = res.steal;
        } else {
            const res = await getMaxValues(bankWorth.get(bank));

            loss = res.loss;
            steal = res.steal;
        }

        const chance = Math.floor(Math.random() * 100);

        const embed = new CustomEmbed(message.member).setHeader("bank robbery", message.author.avatarURL());

        if (chance > 65) {
            const minStolen = Math.floor(steal * 0.5);

            const stolen = Math.floor(Math.random() * (steal - minStolen)) + minStolen;

            await Promise.all([
                await updateBalance(message.member, (await getBalance(message.member)) + stolen),
                await addProgress(message.author.id, "robber", 1),
            ]);

            if (bank == "nypsi") {
                await removeFromNypsiBankBalance(stolen);
            } else {
                bankWorth.set(bank, Math.floor(bankWorth.get(bank) - stolen));
            }

            const embed = new CustomEmbed(message.member)
                .setColor("#5efb8f")
                .setDescription(`**success!**\n\n**you stole** $${stolen.toLocaleString()} from **${bank}**`);

            return embed;
        } else {
            const inventory = await getInventory(message.member);
            let lawyer = false;

            if (inventory["lawyer"] && inventory["lawyer"] > 0) {
                lawyer = true;

                inventory["lawyer"]--;

                if (inventory["lawyer"] <= 0) {
                    delete inventory["lawyer"];
                }

                await setInventory(message.member, inventory);
            }

            const minLoss = Math.floor(loss * 0.4);
            const totalLossed = Math.floor(Math.random() * (loss - minLoss)) + minLoss;

            await updateBalance(message.member, (await getBalance(message.member)) - totalLossed);

            if (bank == "nypsi") {
                await addToNypsiBank(totalLossed);
            } else {
                bankWorth.set(bank, Math.floor(bankWorth.get(bank) + totalLossed * 0.75));
            }

            embed.setColor("#e4334f");

            if (lawyer) {
                embed.setDescription(
                    `**you were caught**\n\nthanks to your lawyer, you only lost $**${totalLossed.toLocaleString()}**`
                );
            } else {
                embed.setDescription(`**you were caught**\n\nyou lost $**${totalLossed.toLocaleString()}**`);
            }
        }

        return embed;
    };

    if (!bankWorths.has(message.author.id)) {
        bankWorths.set(message.author.id, { banks: new Map(defaults), createdAt: Date.now() });
    } else {
        if (bankWorths.get(message.author.id).createdAt < Date.now() - ms("48 hours")) {
            bankWorths.set(message.author.id, { banks: new Map(defaults), createdAt: Date.now() });
        }
    }

    const bankWorth = bankWorths.get(message.author.id).banks;

    const embed = new CustomEmbed(message.member).setHeader("bank robbery", message.author.avatarURL());

    const options: SelectMenuOptionBuilder[] = [];

    const bankNames = Array.from(bankWorth.keys());

    inPlaceSort(bankNames).desc((i) => bankWorth.get(i));

    for (const bankName of bankNames) {
        if (bankWorth.get(bankName) < defaults.get(bankName) * 0.1) continue;

        options.push(
            new SelectMenuOptionBuilder()
                .setLabel(bankName)
                .setValue(bankName)
                .setDescription(`$${bankWorth.get(bankName).toLocaleString()}`)
        );
    }

    if (options.length == 0) {
        return send({ embeds: [new ErrorEmbed("there are no available banks for you to rob")] });
    }

    if ((await getNypsiBankBalance()) > 500_000) {
        options.push(
            new SelectMenuOptionBuilder()
                .setLabel("nypsi bank")
                .setValue("nypsi")
                .setDefault(true)
                .setDescription(`$${(await getNypsiBankBalance()).toLocaleString()}`)
        );
        embed.setDescription(await displayBankInfo("nypsi", bankWorth));
    } else {
        options[0].setDefault(true);
        embed.setDescription(await displayBankInfo(bankNames[0], bankWorth));
    }

    const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

    components.push(
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new SelectMenuBuilder().setCustomId("bank").setOptions(options)
        )
    );

    if (!(await onCooldown(cmd.name, message.member)))
        components.push(
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ButtonBuilder().setCustomId("ro").setLabel("rob").setStyle(ButtonStyle.Danger)
            )
        );

    const msg = await send({ embeds: [embed], components });

    const filter = (i: Interaction) => i.user.id == message.author.id;

    const pageManager: any = async () => {
        const res = await msg
            .awaitMessageComponent({ filter, time: 30_000 })
            .then(async (i) => {
                await i.deferUpdate();
                return i;
            })
            .catch(() => {});

        if (!res) {
            msg.edit({ components: [] });
            return;
        }

        if (res.isSelectMenu() && res.customId == "bank") {
            embed.setDescription(await displayBankInfo(res.values[0], bankWorth));

            for (const option of options) {
                option.setDefault(false);

                if (option.data.value == res.values[0]) option.setDefault(true);
            }

            components[0] = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new SelectMenuBuilder().setCustomId("bank").setOptions(options)
            );

            await res.message.edit({ embeds: [embed], components });
            return pageManager();
        } else if (res.customId == "ro") {
            const selected = options.filter((o) => o.data.default)[0].data.value;

            const newEmbed = await robBank(selected, bankWorth);

            if (!newEmbed) return await res.message.edit({ components: [] });

            await res.followUp({ embeds: [newEmbed] });
            await res.message.edit({ components: [] });
            return;
        }
    };

    return pageManager();
}

cmd.setRun(run);

module.exports = cmd;
