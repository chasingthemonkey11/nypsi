import { GuildMember } from "discord.js";
import { inPlaceSort } from "fast-sort";
import prisma from "../../database/database";
import redis from "../../database/redis";
import { logger } from "../../logger";
import { NypsiClient } from "../../models/Client";
import { GuildUpgradeRequirements } from "../../models/Economy";
import { CustomEmbed } from "../../models/EmbedBuilders";
import requestDM from "../requestdm";
import { getDmSettings } from "../users/notifications";
import { getInventory, setInventory } from "./inventory";
import ms = require("ms");

export async function getGuildByName(name: string) {
  const guild = await prisma.economyGuild
    .findMany({
      where: {
        guildName: {
          mode: "insensitive",
          equals: name,
        },
      },
      include: {
        owner: true,
        members: {
          include: {
            user: {
              select: {
                lastKnownTag: true,
              },
            },
          },
        },
      },
    })
    .then((r) => r[0]);

  return guild;
}

export async function getGuildByUser(member: GuildMember | string) {
  let id: string;
  if (member instanceof GuildMember) {
    id = member.user.id;
  } else {
    id = member;
  }

  let guildName: string;

  if (await redis.exists(`cache:economy:guild:user:${id}`)) {
    guildName = await redis.get(`cache:economy:guild:user:${id}`);

    if (guildName == "noguild") return undefined;
  } else {
    const query = await prisma.economyGuildMember.findUnique({
      where: {
        userId: id,
      },
      select: {
        guild: {
          include: {
            owner: true,
            members: {
              include: {
                user: {
                  select: {
                    lastKnownTag: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!query || !query.guild) {
      await redis.set(`cache:economy:guild:user:${id}`, "noguild");
      await redis.expire(`cache:economy:guild:user:${id}`, ms("1 hour") / 1000);
      return undefined;
    } else {
      await redis.set(`cache:economy:guild:user:${id}`, query.guild.guildName);
      await redis.expire(`cache:economy:guild:user:${id}`, ms("1 hour") / 1000);
    }

    return query.guild;
  }

  return await getGuildByName(guildName);
}

export async function createGuild(name: string, owner: GuildMember) {
  await prisma.economyGuild.create({
    data: {
      guildName: name,
      createdAt: new Date(),
      ownerId: owner.user.id,
    },
  });
  await prisma.economyGuildMember.create({
    data: {
      userId: owner.user.id,
      guildName: name,
      joinedAt: new Date(),
    },
  });

  await redis.del(`cache:economy:guild:user:${owner.user.id}`);
}

export async function deleteGuild(name: string) {
  await prisma.economyGuildMember.deleteMany({
    where: {
      guildName: name,
    },
  });

  await prisma.economyGuild.delete({
    where: {
      guildName: name,
    },
  });
}

export async function addToGuildBank(name: string, amount: number, member: GuildMember, client: NypsiClient) {
  await prisma.economyGuild.update({
    where: {
      guildName: name,
    },
    data: {
      balance: { increment: amount },
    },
  });
  await prisma.economyGuildMember.update({
    where: {
      userId: member.user.id,
    },
    data: {
      contributedMoney: { increment: amount },
    },
  });

  return checkUpgrade(name, client);
}

export async function addToGuildXP(name: string, amount: number, member: GuildMember, client: NypsiClient) {
  await prisma.economyGuild.update({
    where: {
      guildName: name,
    },
    data: {
      xp: { increment: amount },
    },
  });
  await prisma.economyGuildMember.update({
    where: {
      userId: member.user.id,
    },
    data: {
      contributedXp: { increment: amount },
    },
  });

  return checkUpgrade(name, client);
}

export async function getMaxMembersForGuild(name: string) {
  const guild = await getGuildByName(name);

  return guild.level * 3;
}

export async function getRequiredForGuildUpgrade(name: string): Promise<GuildUpgradeRequirements> {
  if (await redis.exists(`cache:economy:guild:requirements:${name}`)) {
    return JSON.parse(await redis.get(`cache:economy:guild:requirements:${name}`));
  }

  const guild = await getGuildByName(name);

  const baseMoney = 5000000 * Math.pow(guild.level, 2);
  const baseXP = 1425 * Math.pow(guild.level, 2);

  const bonusMoney = 100000 * guild.members.length;
  const bonusXP = 75 * guild.members.length;

  await redis.set(
    `cache:economy:guild:requirements:${name}`,
    JSON.stringify({
      money: baseMoney + bonusMoney,
      xp: baseXP + bonusXP,
    })
  );
  await redis.expire(`cache:economy:guild:requirements:${name}`, ms("1 hour") / 1000);

  return {
    money: baseMoney + bonusMoney,
    xp: baseXP + bonusXP,
  };
}

export async function addMember(name: string, member: GuildMember) {
  const guild = await getGuildByName(name);

  if (guild.members.length + 1 > (await getMaxMembersForGuild(guild.guildName))) {
    return false;
  }

  await prisma.economyGuildMember.create({
    data: {
      userId: member.user.id,
      guildName: guild.guildName,
      joinedAt: new Date(),
    },
  });

  await redis.del(`cache:economy:guild:user:${member.user.id}`);

  return true;
}

export enum RemoveMemberMode {
  ID,
  TAG,
}

export async function removeMember(member: string, mode: RemoveMemberMode) {
  if (mode == RemoveMemberMode.ID) {
    await prisma.economyGuildMember.delete({
      where: {
        userId: member,
      },
    });
    await redis.del(`cache:economy:guild:user:${member}`);
    return true;
  } else {
    const user = await prisma.user.findFirst({
      where: {
        lastKnownTag: member,
      },
      select: {
        id: true,
      },
    });

    if (!user || !user.id) {
      return false;
    }

    const x = await prisma.economyGuildMember.delete({
      where: {
        userId: user.id,
      },
    });

    if (x) {
      await redis.del(`cache:economy:guild:user:${x.userId}`);

      return true;
    }
    return false;
  }
}

interface EconomyGuild {
  guildName: string;
  createdAt: Date;
  balance: number;
  xp: number;
  level: number;
  motd: string;
  ownerId: string;
  members?: EconomyGuildMember[];
}

interface EconomyGuildMember {
  userId: string;
  guildName: string;
  joinedAt: Date;
  contributedMoney: number;
  contributedXp: number;
}

async function checkUpgrade(guild: EconomyGuild | string, client: NypsiClient): Promise<boolean> {
  if (typeof guild == "string") {
    guild = await getGuildByName(guild);
  }

  if (guild.level == 5) return;
  const requirements = await getRequiredForGuildUpgrade(guild.guildName);

  if (guild.balance >= requirements.money && guild.xp >= requirements.xp) {
    await prisma.economyGuild.update({
      where: {
        guildName: guild.guildName,
      },
      data: {
        level: { increment: 1 },
        balance: { decrement: requirements.money },
        xp: { decrement: requirements.xp },
      },
    });

    logger.info(`${guild.guildName} has upgraded to level ${guild.level + 1}`);

    await redis.del(`cache:economy:guild:requirements:${guild.guildName}`);

    const embed = new CustomEmbed().setColor("#5efb8f");

    embed.setHeader(guild.guildName);
    embed.setDescription(
      `**${guild.guildName}** has upgraded to level **${guild.level + 1}**\n\nyou have received:` +
        `\n +**${guild.level}** basic crates` +
        "\n +**1**% multiplier" +
        "\n +**1** max xp gain"
    );
    embed.disableFooter();

    for (const member of guild.members) {
      const inventory = await getInventory(member.userId);

      if (inventory["basic_crate"]) {
        inventory["basic_crate"] += guild.level;
      } else {
        inventory["basic_crate"] = guild.level;
      }

      await setInventory(member.userId, inventory);

      if ((await getDmSettings(member.userId)).other) {
        await requestDM({
          memberId: member.userId,
          client: client,
          content: `${guild.guildName} has been upgraded!`,
          embed: embed,
        });
      }
    }

    return true;
  }
  return false;
}

export async function setGuildMOTD(name: string, motd: string) {
  await prisma.economyGuild.update({
    where: {
      guildName: name,
    },
    data: {
      motd: motd,
    },
  });
}

export async function topGuilds(limit = 5) {
  const guilds = await prisma.economyGuild.findMany({
    where: {
      balance: { gt: 1000 },
    },
    select: {
      guildName: true,
      balance: true,
      xp: true,
      level: true,
    },
  });

  inPlaceSort(guilds).desc([(i) => i.level, (i) => i.balance, (i) => i.xp]);

  const out: string[] = [];

  for (const guild of guilds) {
    if (out.length >= limit) break;
    let position: number | string = guilds.indexOf(guild) + 1;

    if (position == 1) position = "🥇";
    if (position == 2) position = "🥈";
    if (position == 3) position = "🥉";

    out.push(`${position} **${guild.guildName}**[${guild.level}] $${guild.balance.toLocaleString()}`);
  }

  return out;
}
