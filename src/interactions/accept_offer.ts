import { EmbedBuilder } from "discord.js";
import prisma from "../init/database";
import redis from "../init/redis";
import { NypsiClient } from "../models/Client";
import { CustomEmbed, ErrorEmbed } from "../models/EmbedBuilders";
import { InteractionHandler } from "../types/InteractionHandler";
import Constants from "../utils/Constants";
import { getBalance, updateBalance } from "../utils/functions/economy/balance";
import { addInventoryItem, getInventory, setInventoryItem } from "../utils/functions/economy/inventory";
import { checkOffer } from "../utils/functions/economy/offers";
import { getItems, isEcoBanned } from "../utils/functions/economy/utils";
import { addNotificationToQueue, getDmSettings } from "../utils/functions/users/notifications";
import { transaction } from "../utils/logger";

export default {
  name: "accept-offer",
  type: "interaction",
  async run(interaction) {
    if (!interaction.isButton()) return;
    if (await isEcoBanned(interaction.user.id)) return;

    if (await redis.exists(`${Constants.redis.nypsi.OFFER_PROCESS}:${interaction.user.id}`)) {
      return interaction.reply({
        embeds: [
          new CustomEmbed(null, "please wait until your offer has been processed").setColor(
            Constants.TRANSPARENT_EMBED_COLOR
          ),
        ],
        ephemeral: true,
      });
    }

    await redis.set(`${Constants.redis.nypsi.OFFER_PROCESS}:${interaction.user.id}`, "t");
    await redis.expire(`${Constants.redis.nypsi.OFFER_PROCESS}:${interaction.user.id}`, 69);

    const offer = await prisma.offer.findUnique({
      where: {
        messageId: interaction.message.id,
      },
    });

    if (!offer) {
      return await redis.del(`${Constants.redis.nypsi.OFFER_PROCESS}:${interaction.user.id}`);
    }

    await interaction.deferReply({ ephemeral: true });

    const inventory = await getInventory(interaction.user.id, false);

    if (
      !inventory.find((i) => i.item === offer.itemId) ||
      inventory.find((i) => i.item === offer.itemId).amount < offer.itemAmount
    ) {
      await redis.del(`${Constants.redis.nypsi.OFFER_PROCESS}:${interaction.user.id}`);
      return interaction.editReply({ embeds: [new ErrorEmbed("you don't have the items for this offer")] });
    }

    await prisma.offer.delete({
      where: {
        messageId: offer.messageId,
      },
    });

    await setInventoryItem(
      interaction.user.id,
      offer.itemId,
      inventory.find((i) => i.item === offer.itemId).amount - Number(offer.itemAmount),
      false
    );
    await updateBalance(interaction.user.id, (await getBalance(interaction.user.id)) + Number(offer.money));
    await addInventoryItem(offer.ownerId, offer.itemId, Number(offer.itemAmount));

    await interaction.editReply({
      embeds: [new CustomEmbed(null, "offer accepted").setColor(Constants.EMBED_SUCCESS_COLOR)],
    });

    const embed = new EmbedBuilder(interaction.message.embeds[0]);

    embed.setDescription((embed.data.description.split("\n")[0] += "\n\n**offer accepted**"));

    await interaction.message.edit({ embeds: [embed], components: [] });

    if ((await getDmSettings(offer.ownerId)).auction) {
      await addNotificationToQueue({
        memberId: offer.ownerId,
        payload: {
          content: `your offer to ${interaction.user.tag} for ${offer.itemAmount}x ${
            getItems()[offer.itemId].name
          } has been accepted`,
        },
      });
    }

    for (const testOffer of await prisma.offer.findMany({
      where: { AND: [{ targetId: interaction.user.id }, { itemId: offer.itemId }] },
    })) {
      await checkOffer(testOffer, interaction.client as NypsiClient);
    }

    await redis.del(`${Constants.redis.nypsi.OFFER_PROCESS}:${interaction.user.id}`);

    transaction(
      interaction.user,
      await interaction.client.users.fetch(offer.ownerId),
      `${offer.itemAmount}x ${offer.itemId}`
    );
    transaction(await interaction.client.users.fetch(offer.ownerId), interaction.user, `$${offer.money.toLocaleString()}`);
  },
} as InteractionHandler;