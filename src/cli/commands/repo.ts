import program from "commander";
import { makeLogger } from "../../lib/logging"
import { Repo } from "../../lib/repo";
import path from "path";

const logger = makeLogger("Repo Command")

export const addRepoCommand = (repo: Repo): program.Command => {
   const repoCommand = program.command("repo")
      .description("Manage carti package listing repo")
   repoCommand.command("add <src>")
      .description("add package listing repo")
      .action(async (src) => {
         if (!src) {
            throw new Error("could not add missing listing")
         }
         return repo.add(src)
      })
   repoCommand.command("update [src]")
      .description("update all package listings or an individual package repo")
      .action((src) => repo.update(path.resolve(src)))
   repoCommand.command("rm <src>")
      .description("remove")
      .action(async (src) => repo.rm(path.resolve(src)))
   return repoCommand
}