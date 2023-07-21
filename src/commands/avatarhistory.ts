import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CommandInteraction,
  Interaction,
  Message,
  MessageActionRowComponentBuilder,
} from "discord.js";
import { NypsiClient } from "../models/Client";
import { Command, NypsiCommandInteraction } from "../models/Command";
import { CustomEmbed, ErrorEmbed } from "../models/EmbedBuilders";
import { formatDate } from "../utils/functions/date";
import { getPrestige } from "../utils/functions/economy/prestige";
import { uploadImage } from "../utils/functions/image";
import {
  addNewAvatar,
  clearAvatarHistory,
  deleteAvatar,
  fetchAvatarHistory,
  isTracking,
} from "../utils/functions/users/history";
import { addCooldown, getResponse, onCooldown } from "../utils/handlers/cooldownhandler";

const cmd = new Command("avatarhistory", "view a user's avatar history", "info").setAliases([
  "avh",
  "avhistory",
  "pfphistory",
  "pfph",
]);

async function run(
  message: Message | (NypsiCommandInteraction & CommandInteraction),
  args: string[],
) {
  if (await onCooldown(cmd.name, message.member)) {
    const embed = await getResponse(cmd.name, message.member);

    return message.channel.send({ embeds: [embed] });
  }

  if (args.length > 0 && args[0].toLowerCase() == "-clear") {
    await clearAvatarHistory(message.member);
    return message.channel.send({
      embeds: [new CustomEmbed(message.member, "✅ your avatar history has been cleared")],
    });
  }

  await addCooldown(cmd.name, message.member, 15);

  if ((await getPrestige(message.member).catch(() => 0)) < 2)
    return message.channel.send({
      embeds: [
        new ErrorEmbed(
          "you require at least prestige 2 (/prestige) for nypsi to track your avatars\n\nyou can disable avatar tracking with $toggletracking",
        ),
      ],
    });

  let history = await fetchAvatarHistory(message.member);

  if (history.length == 0) {
    const url = await uploadImage(
      message.client as NypsiClient,
      message.author.displayAvatarURL({ extension: "png", size: 256 }),
      "avatar",
      `user: ${message.author.id} (${message.author.username})`,
    );
    if (url) {
      await addNewAvatar(message.member, url);
      history = await fetchAvatarHistory(message.member);
    } else {
      return message.channel.send({ embeds: [new ErrorEmbed("no avatar history")] });
    }
  }

  let index = 0;

  if (parseInt(args[1]) - 1) {
    index = parseInt(args[1]) - 1;

    if (!history[index]) index = 0;
  }

  const embed = new CustomEmbed(message.member)
    .setHeader("your avatar history")
    .setImage(history[index].value)
    .setFooter({ text: formatDate(history[index].date) });

  if (history.length > 1) {
    embed.setFooter({
      text: `${formatDate(history[index].date)} | ${index + 1}/${history.length}`,
    });
  }

  if (!(await isTracking(message.member))) {
    embed.setDescription("`[tracking disabled]`");
  }

  let row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("⬅")
      .setLabel("back")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder().setCustomId("➡").setLabel("next").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("d").setLabel("delete").setStyle(ButtonStyle.Danger),
  );

  let msg: Message;

  if (history.length == 1) {
    return await message.channel.send({ embeds: [embed] });
  } else {
    msg = await message.channel.send({ embeds: [embed], components: [row] });
  }

  let currentPage = index + 1;
  const lastPage = history.length;

  const filter = (i: Interaction) => i.user.id == message.author.id;

  const pageManager = async (): Promise<void> => {
    const reaction = await msg
      .awaitMessageComponent({ filter, time: 30000 })
      .then(async (collected) => {
        await collected.deferUpdate();
        return collected;
      })
      .catch(async () => {
        await msg.edit({ components: [] });
      });

    if (!reaction) return;

    const newEmbed = new CustomEmbed(message.member);

    if (!(await isTracking(message.member))) {
      newEmbed.setDescription("`[tracking disabled]`");
    }

    if (reaction.customId == "⬅") {
      if (currentPage <= 1) {
        return pageManager();
      } else {
        currentPage--;

        newEmbed.setHeader("your avatar history");
        newEmbed.setImage(history[currentPage - 1].value);
        newEmbed.setFooter({
          text: `${formatDate(history[currentPage - 1].date)} | ${currentPage}/${history.length}`,
        });
        if (currentPage == 1) {
          row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId("⬅")
              .setLabel("back")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId("➡")
              .setLabel("next")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(false),
            new ButtonBuilder().setCustomId("d").setLabel("delete").setStyle(ButtonStyle.Danger),
          );
        } else {
          row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId("⬅")
              .setLabel("back")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(false),
            new ButtonBuilder()
              .setCustomId("➡")
              .setLabel("next")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(false),
            new ButtonBuilder().setCustomId("d").setLabel("delete").setStyle(ButtonStyle.Danger),
          );
        }
        await msg.edit({ embeds: [newEmbed], components: [row] });
        return pageManager();
      }
    } else if (reaction.customId == "➡") {
      if (currentPage >= lastPage) {
        return pageManager();
      } else {
        currentPage++;

        newEmbed.setHeader("your avatar history");
        newEmbed.setImage(history[currentPage - 1].value);
        newEmbed.setFooter({
          text: `${formatDate(history[currentPage - 1].date)} | ${currentPage}/${history.length}`,
        });
        if (currentPage == lastPage) {
          row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId("⬅")
              .setLabel("back")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(false),
            new ButtonBuilder()
              .setCustomId("➡")
              .setLabel("next")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(true),
            new ButtonBuilder().setCustomId("d").setLabel("delete").setStyle(ButtonStyle.Danger),
          );
        } else {
          row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId("⬅")
              .setLabel("back")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(false),
            new ButtonBuilder()
              .setCustomId("➡")
              .setLabel("next")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(false),
            new ButtonBuilder().setCustomId("d").setLabel("delete").setStyle(ButtonStyle.Danger),
          );
        }
        await msg.edit({ embeds: [newEmbed], components: [row] });
        return pageManager();
      }
    } else if (reaction.customId == "d") {
      const res = await deleteAvatar(history[currentPage - 1].id);

      if (res) {
        await reaction.followUp({
          embeds: [new CustomEmbed(message.member, "✅ successfully deleted this avatar")],
          ephemeral: true,
        });
      } else {
        await reaction.followUp({
          embeds: [new CustomEmbed(message.member, "failed to delete this avatar")],
          ephemeral: true,
        });
      }

      return pageManager();
    }
  };

  return pageManager();
}

cmd.setRun(run);

module.exports = cmd;
