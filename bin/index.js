#!/usr/bin/env node

const Git = require("nodegit");
const util = require("util");
const path = require("path");
const fs = require("fs");
const exec = util.promisify(require("child_process").exec);
const { WebClient } = require("@slack/web-api");
const args = require("yargs").argv;

const token = process.env.SLACK_TOKEN;

const web = new WebClient(token);

const directory = process.cwd();
console.log("directory: ", directory);

async function getBranchName(repo) {
  const currentBranch = await repo.getCurrentBranch();
  const branchName = currentBranch.name().replace("refs/heads/", "");
  return branchName;
}

async function sendSlackMessage(fullMessage) {
  let channelIds = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../channels.json"), "utf8")
  );
  if (args.channel) {
    const response = await web.users.conversations();
    const allChannels = response.channels;
    const channel = allChannels.find(
      (channel) => channel.name === args.channel
    );
    channelIds[directory] = channel.id;
    fs.writeFileSync(
      path.resolve(__dirname, "../channels.json"),
      JSON.stringify(channelIds)
    );
  }
  if (channelIds[directory] && fullMessage) {
    const res = await web.chat.postMessage({
      channel: channelIds[directory],
      text: fullMessage,
    });
  }
}

async function getBranchCommitCount(branchName) {
  try {
    const { stdout, stderr } = await exec(
      `git log --walk-reflogs ${branchName} --pretty=oneline | wc -l`,
      {
        cwd: directory,
      }
    );
    return Number(stdout.trim());
    if (stderr) {
      console.log("stderr:", stderr);
    }
  } catch (err) {
    console.error(err);
  }
}

async function sendStatusUpdate() {
  const repo = await Git.Repository.open(directory);
  const branchName = await getBranchName(repo);
  const branchCommits = await repo.getHeadCommit();
  const history = await branchCommits.history();
  const commitCount = await getBranchCommitCount(branchName);
  let count = 0;
  let fullMessage = `#${branchName.match(/^\d+/)} (${branchName
    .replace(/^\d+/, "")
    .replace(/-/g, " ")
    .replace("task", "")
    .replace("bug", "")
    .trim()}) status update:  `;
  await history.on("commit", function (commit) {
    if (++count >= commitCount) {
      return;
    }
    const message = commit.message().trim();
    fullMessage = fullMessage + message + ". ";
  });
  history.on("end", async function () {
    await sendSlackMessage(fullMessage);
  });
  await history.start();
}

sendStatusUpdate();
