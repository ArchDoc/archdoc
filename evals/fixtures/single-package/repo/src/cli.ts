import { Command } from "commander";
import { check } from "./commands/check.js";
import { fix } from "./commands/fix.js";

new Command("mdlint")
  .addCommand(new Command("check").argument("<files...>").action(check))
  .addCommand(new Command("fix").argument("<files...>").action(fix))
  .parse();
