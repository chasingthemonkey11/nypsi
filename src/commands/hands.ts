import { CommandInteraction, Message } from "discord.js";
import redis from "../init/redis";
import { Command, NypsiCommandInteraction } from "../models/Command";
import { CustomEmbed, ErrorEmbed } from "../models/EmbedBuilders.js";
import { RedditJSONPost } from "../types/Reddit";
import { addProgress } from "../utils/functions/economy/achievements";
import { redditImage } from "../utils/functions/image";
import { addCooldown, getResponse, onCooldown } from "../utils/handlers/cooldownhandler";

const cmd = new Command("hands", "get a random hand image. horny slut", "nsfw").setAliases([
  "hand",
]);

async function run(message: Message | (NypsiCommandInteraction & CommandInteraction)) {
  if (await onCooldown(cmd.name, message.member)) {
    const embed = await getResponse(cmd.name, message.member);

    return message.channel.send({ embeds: [embed] });
  }

  if (!message.channel.isTextBased()) return;

  if (message.channel.isDMBased()) return;

  if (message.channel.isThread())
    return message.channel.send({
      embeds: [new ErrorEmbed("you must do this in an nsfw channel")],
    });

  if (!message.channel.nsfw) {
    return message.channel.send({
      embeds: [new ErrorEmbed("you must do this in an nsfw channel")],
    });
  }

  const posts = await redis
    .lrange("nypsi:images:hands", 0, -1)
    .then((i) => i.map((j) => JSON.parse(j) as RedditJSONPost));

  if (posts.length < 10) {
    return message.channel.send({
      embeds: [new ErrorEmbed("please wait a couple more seconds..")],
    });
  }

  await addCooldown(cmd.name, message.member, 7);

  const chosen = posts[Math.floor(Math.random() * posts.length)];

  const a = await redditImage(chosen, posts);

  if (a == "lol") {
    return message.channel.send({ embeds: [new ErrorEmbed("unable to find hands image")] });
  }

  const image = a.split("|")[0];
  const title = a.split("|")[1];
  let url = a.split("|")[2];
  const author = a.split("|")[3];

  url = "https://reddit.com" + url;

  const embed = new CustomEmbed(message.member)
    .setTitle(title)
    .setHeader("u/" + author + " | r/" + chosen.data.subreddit)
    .setURL(url)
    .setImage(image);

  message.channel.send({ embeds: [embed] });

  addProgress(message.author.id, "horny", 1);
}

cmd.setRun(run);

module.exports = cmd;
