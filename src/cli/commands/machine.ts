import program from "commander";
import { makeLogger } from "../../lib/logging"
import { machineConfigPackage } from "@createdreamtech/carti-core"
import * as clib from "@createdreamtech/carti-core"
import { Bundle, bundle, PackageEntryOptions, generateLuaConfig } from "@createdreamtech/carti-core"
import { Config, getMachineConfig, initMachineConfig, writeMachineConfig } from "../../lib/config"
import inquirer from "inquirer"
import { shortDesc, parseShortDesc } from "../../lib/bundle";
import * as utils from "../util"
import os from "os"
import https from "https"
import fs from "fs-extra"
import { spawnSync } from "child_process";
import path from "path"
import rimraf from "rimraf";
import { promisify } from 'util';
import { bundleFetcher } from "../../lib/fetcher";
import { Readable } from "stream";
import { fromStreamToStr } from "../../lib/utils";
import url from "url"
import { CID } from "multiformats";
const rmAll = promisify(rimraf)

type addMachineCommandType = "ram" | "rom" | "flashdrive" | "raw";

export const addMachineCommand = (config: Config): program.Command => {
    const add = (addType: addMachineCommandType) => {
        return (name: string, options: PackageEntryOptions) => {
            const { length, start, bootargs, shared } = options
            return handleAdd(config, name, { length, start, bootargs, shared }, addType)
        }
    }
    const machineCommand = program.command("machine")
        .description("Utilize cartesi machine commands to specify and generate stored machines")
        .storeOptionsAsProperties(false)
        .passCommandToAction(false)

    const machineAddCommand = new program.Command("add")
        .description("Add bundle to cartesi machine description using ram | rom | flashdrive | raw options")
        .storeOptionsAsProperties(false)
        .passCommandToAction(false)

    machineAddCommand.command("ram <bundle>")
        .storeOptionsAsProperties(false)
        .passCommandToAction(false)
        .description("add a bundle to the ram entry for carti-machine-package.json")
        .requiredOption("-l, --length <length>", "length of the drive in hex format ex. 0x4000")
        .option("-r, --resolvedpath <resolvedpath>", "specify a package outside of a cid the mechanism default uses")
        .action(add("ram"))

    machineAddCommand.command("flash <bundle>")
        .requiredOption("-l, --length <length>", "length of the drive in hex format ex. 0x4000000")
        .requiredOption("-s, --start <start>", "start position of the drive in hex format ex. 0x800000")
        .option("-r, --resolvedpath <resolvedpath>", "specify a package outside of a cid the mechanism default uses")
        .description("add a bundle to the flash entry for carti-machine-package.json")
        .action(add("flashdrive"))

    machineAddCommand.command("rom <bundle>")
        .description("add a bundle to the rom entry for carti-machine-package.json")
        .option("-b, --bootargs <bootargs>", "boot arguments for the rom")
        .option("-r, --resolvedpath <resolvedpath>", "specify a package outside of a cid the mechanism default uses")
        .action(add("rom"))

    /*
        TODO: Feature needs more integration placeholder here. Pending implementation
        machineAddCommand.command("raw <bundle> - pending ")
        .description("add a raw asset bundle to the entry for carti-machine-package.json")
        .action(add("raw"))
        */

    machineCommand.addCommand(machineAddCommand)
    machineCommand.command("build")
        .description("Build a stored machine from carti-machine-package.json")
        .action(async () => {
            return handleBuild(config)
        })

    machineCommand.command("init")
        .description("Init a stored machine from carti-machine-package.json it is destructive")
        .action(handleInit)


    machineCommand.command("install <uri>")
        .description("Install a cartesi machine, installing bundles and optionally building a stored machine from a uri or file path specified carti-machine-package.json")
        .option("--nobuild", "install remote machine bundles but do not build stored machine")
        .action(async (uri,options) => handleInstall(config, uri,options.nobuild))

    return machineCommand
}


const renderBundle = (b: Bundle): string => {
    const { bundleType, name, version, id } = b;
    return shortDesc({ bundleType, name, version, id, uri: "local" })
}

async function handleInit() {
    return initMachineConfig()
}

async function getPackageFile(uri: string): Promise<Readable> {
    if (url.parse(uri).protocol === null)
        return fs.createReadStream(path.resolve(uri))

    return new Promise((resolve) => {
        https.get(uri, (message) => {
            resolve(message)
        })
    })
}


async function handleInstall(config: Config, uri: string, nobuild:boolean): Promise<void> {
    //TODO add error handling here
    const packageConfig: machineConfigPackage.CartiPackage = JSON.parse(await fromStreamToStr(await getPackageFile(uri)))
    //check packages can all be resolved

    for (const asset of packageConfig.assets) {
        const bundles = await config.globalConfigStorage.getById(asset.cid)
        if (bundles === [] || bundles === undefined)
            throw new Error(`Could not resolve bundle for id:${asset.cid} name:${asset.name} try adding the repo`)
        const exists = await config.bundleStorage.diskProvider.exists(CID.parse(asset.cid))
        if (exists)
            break
        await bundle.install(bundles[0], bundleFetcher(bundles[0].uri as string), config.bundleStorage)
        const path = await config.bundleStorage.path(CID.parse(bundles[0].id))
        await config.localConfigStorage.add(path, [bundles[0]])
    }
    if(nobuild)
        return 

    return buildMachine(config, packageConfig)
}

async function handleAdd(config: Config, name: string, options: clib.PackageEntryOptions, addType: addMachineCommandType): Promise<void> {
    const bundles: Bundle[] = await config.localConfigStorage.get(name)
    const question = utils.pickBundle("Which bundle would you like to add to your cartesi machine build", bundles, renderBundle)
    const answer = await inquirer.prompt([question])
    const { id } = parseShortDesc(answer.bundle)
    const bundle = bundles.filter((b) => b.id === id)[0]
    let cfg = await getMachineConfig()
    cfg = clib.updatePackageEntry(bundle, cfg, options)
    return writeMachineConfig(cfg)
}

async function handleBuild(config: Config): Promise<void> {
    return buildMachine(config, await getMachineConfig())
}

async function buildMachine(config: Config, cfg: machineConfigPackage.CartiPackage): Promise<void> {
    //const tmpDir = await fs.mkdtemp(`${os.tmpdir()}/carti_build_package`)
    const tmpDir = path.resolve(await fs.mkdtemp(`carti_build_package`))
    const machineConfig = await clib.install(cfg, config.bundleStorage, tmpDir)
    const luaConfig = generateLuaConfig(machineConfig, "return")
    await fs.writeFile(`${tmpDir}/machine-config.lua`, luaConfig)
    await fs.copyFile(`${__dirname}/../../scripts/run-config.lua`, `${tmpDir}/run-config.lua`)
    await runPackageBuild(tmpDir)
    //clean up
    return rmAll(tmpDir)
}


async function runPackageBuild(packageDir: string) {
    const { uid, gid, username } = os.userInfo()
    const command = ["run",
        "-e",
        `USER=${username}`,
        "-e",
        `UID=${uid}`,
        "-e",
        `GID=${gid}`,
        "-v",
        `${packageDir}:/opt/carti/packages`,
        "cartesi/playground:0.1.1",
        "/bin/bash",
        "-c",
        //"cd /opt/cartesi/packages && echo $(ls -l)" ]
        "cd /opt/carti/packages && luapp5.3 run-config.lua machine-config && echo 'package built'"]
    console.log("docker " + command.join(" "))
    //TODO improve should stream output to stdout
    const result = spawnSync("docker", command)
    if (result.error || result.stderr.toString()) {
        console.error(result.stderr.toString())
        return;
    }
    console.log(result.stdout.toString())
    const storedMachinePath = `${packageDir}/cartesi-machine`
    if (fs.existsSync(`${process.cwd()}/stored_machine`))
        await rmAll(`${process.cwd()}/stored_machine`)

    //NOTE just renaming to keep path's consistent
    await fs.move(storedMachinePath, `${process.cwd()}/stored_machine`)
    await rmAll(storedMachinePath)
    const loadMachineCommand = `docker run -e USER=$(id -u -n) -e UID=$(id -u) -e GID=$(id -g) \\
-v $(pwd)/cartesi-machine:/opt/cartesi-machine \\
cartesi/playground cartesi-machine --load='/opt/cartesi-machine'`
    console.log(`Copy command to run stored machine:`)
    console.log(`${loadMachineCommand}`)
}
