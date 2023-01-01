import { BaseMessageOptions, CommandInteraction, InteractionReplyOptions, Message } from "discord.js";
import prisma from "../init/database";
import { Categories, Command, NypsiCommandInteraction } from "../models/Command";
import { ErrorEmbed } from "../models/EmbedBuilders";
import { ChartData } from "../types/Chart";
import Constants from "../utils/Constants";
import { isPremium } from "../utils/functions/premium/premium";
import getJsonGraphData from "../utils/functions/workers/jsongraph";
import { addCooldown, getResponse, onCooldown } from "../utils/handlers/cooldownhandler";
import dayjs = require("dayjs");

const BASE_URL = "https://quickchart.io/chart?c=";

const cmd = new Command("ecohistory", "view your metric data history in a graph", Categories.MONEY).setAliases(["graph"]);

async function run(message: Message | (NypsiCommandInteraction & CommandInteraction), args: string[]) {
  const send = async (data: BaseMessageOptions | InteractionReplyOptions) => {
    if (!(message instanceof Message)) {
      if (message.deferred) {
        await message.editReply(data);
      } else {
        await message.reply(data as InteractionReplyOptions).catch(() => {
          return message.editReply(data);
        });
      }
      const replyMsg = await message.fetchReply();
      if (replyMsg instanceof Message) {
        return replyMsg;
      }
    } else {
      return await message.channel.send(data as BaseMessageOptions);
    }
  };

  if (await onCooldown(cmd.name, message.member)) {
    const embed = await getResponse(cmd.name, message.member);

    return send({ embeds: [embed], ephemeral: true });
  }

  if (!(await isPremium(message.member))) {
    return send({ embeds: [new ErrorEmbed("this command requires premium membership. /premium")] });
  }

  if (args.length == 0) {
    return send({
      embeds: [
        new ErrorEmbed("**$graph balance** graph your balance history\n**$graph networth** graph your networth history"),
      ],
    });
  }

  if (args[0].toLowerCase() == "all" && Constants.ADMIN_IDS.includes(message.author.id)) {
    const res = await getJsonGraphData(args[1].toLowerCase());

    return send({ content: `${BASE_URL}${encodeURIComponent(JSON.stringify(res))}` });
  }

  await addCooldown(cmd.name, message.member, 120);

  if (args[0].toLowerCase() == "balance") args[0] = "user-money";
  if (args[0].toLowerCase() == "networth") args[0] = "user-net";

  const formatDataForUser = (data: { date: Date; value: number | bigint; userId?: string }[]): ChartData => {
    if (data.length == 0) {
      return null;
    }

    const chartData: ChartData = {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: message.author.tag,
            data: [],
          },
        ],
      },
    };

    for (const item of data) {
      chartData.data.labels.push(dayjs(item.date).format("YYYY-MM-DD"));
      chartData.data.datasets[0].data.push(Number(item.value));
    }

    return chartData;
  };

  const data = formatDataForUser(
    await prisma.graphMetrics.findMany({
      where: {
        AND: [{ category: args[0] }, { userId: message.author.id }],
      },
    })
  );

  console.log(data);

  const url = `${BASE_URL}${encodeURIComponent(JSON.stringify(data))}`;

  console.log(url);

  return send({
    content: url,
  });
}

cmd.setRun(run);

module.exports = cmd;