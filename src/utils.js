"use strict";
import { spawnSync } from "child_process";

function matchStr(str) {
  return str
    .toLowerCase()
    .split(/[^a-zA-Z0-9]/)
    .concat(str.toLowerCase())
    .filter(Boolean)
    .join(" ");
}

function convertSize(b) {
  if (isNaN(b)) return "";
  for (const unit of ["", "K", "M", "G"]) {
    if (b < 1024.0) {
      return `${b.toFixed(1)} ${unit}B`;
    } else {
      b /= 1024;
    }
  }
  return `${b.toFixed(1)} TB`;
}

function datetimeFormat(date) {
  date = new Date(date);
  const interval = (new Date() - date) / 1000;
  if (interval <= 15 * 60) {
    // just now
    return "just now";
  } else if (interval < 60 * 60) {
    // less than an hour
    const minutes = (interval / 60).toFixed();
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  } else if (interval < 24 * 60 * 60) {
    // less than a day
    const hours = (interval / 60 / 60).toFixed();
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  } else if (interval <= 7 * 24 * 60 * 60) {
    // less than a week
    const days = (interval / 24 / 60 / 60).toFixed();
    return `${days} day${days > 1 ? "s" : ""} ago`;
  } else if (interval <= 30 * 24 * 60 * 60) {
    // less than a month
    const weeks = (interval / 7 / 24 / 60 / 60).toFixed();
    return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
  } else if (date.getFullYear() === new Date().getFullYear()) {
    // within the same year
    return (
      date.getDate() + " " + date.toLocaleString("default", { month: "short" })
    );
  } else {
    return (
      date.getDate() +
      " " +
      date.toLocaleString("default", { month: "short" }) +
      " " +
      date.getFullYear()
    );
  }
}

function convertNum(num) {
  if (!num) return null;
  return num < 1e3
    ? num
    : num < 1e6
      ? (num / 1e3).toFixed(1) + "k"
      : (num / 1e6).toFixed(1) + "m";
}

function notify(message, subtitle = "") {
  spawnSync("terminal-notifier", [
    "-title",
    "GitHub",
    "-message",
    message,
    "-subtitle",
    subtitle,
    "-sender",
    "com.runningwithcrayons.Alfred",
    "-contentImage",
    "icon.png",
  ]);
}

class Enum extends Array {
  constructor(...args) {
    super(...args);
  }
}

export { convertSize, datetimeFormat, convertNum, matchStr, notify, Enum };
