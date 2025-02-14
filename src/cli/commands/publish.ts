import program from "commander";
import { makeLogger } from "../../lib/logging"
import * as clib from "@createdreamtech/carti-core"
import { Bundle, Storage, bundle, DiskProvider, S3Provider, MemoryProvider } from "@createdreamtech/carti-core"
import { Config } from "../../lib/config"
import inquirer from "inquirer"
import * as utils from "../util"
import path from "path";
import { shortDesc, parseShortDesc } from "../../lib/bundle";

const logger = makeLogger("Publish Command")

export const addPublishCommand = (config: Config): program.Command => {
    const publishCommand = program.command("publish")
        .description("Publish carti bundle to permanent storage")
    publishCommand.command("s3 <bundleName> <uri>")
        .description("add bundle to s3 adds to bundles.json")
        .usage("s3 --bucket <bucket> bundleName publicURI")
        .option("--nosave", "don't upload to s3")
        .requiredOption("--bucket <bucket>", "Name of the s3 bucket to upload to")
        .action(async (bundleName, uri, options) => {
            await handlePublish(config, bundleName, new Storage(new S3Provider(options.bucket)), uri, options.nosave)
            console.log(`published to s3:${options.bucket}`)
        })
    publishCommand.command("disk <src> <path>")
        .description("Publish file to disk storage for testing add to bundles.json")
        .option("--nosave", "don't add to disk")
        .action(async (src, pth, options) => {
            const absPath = path.resolve(pth)
            await handlePublish(config, src, new Storage(new DiskProvider(absPath)), absPath, options.nosave)
            console.log(`published to path:${absPath}`)
        })
    publishCommand.command("uri <bundle> <uri>")
        .description("Just takes a bundle name and uri/abspath adds to bundles.json w/o uploading")
        .action(async (bundle, uri, options) => {
            await handlePublish(config, bundle, new Storage(new MemoryProvider()), uri, true)
            console.log(`published to uri:${uri}`)
        })
    return publishCommand
}


const renderBundle = (b: Bundle): string => {
    const { bundleType, name, version, id } = b;
    return shortDesc({ bundleType, name, version, id, uri: "local" })
}

async function handlePublish(config: Config, name: string, storage: Storage, uri?: string, nosave?:boolean): Promise<void> {
    const bundles: Bundle[] = await config.localConfigStorage.get(name)
    const question = utils.pickBundle("Which bundle would you like to publish", bundles, renderBundle)
    const answer = await inquirer.prompt([question])
    const { id } = parseShortDesc(answer.bundle)
    const bundle = bundles.filter((b) => b.id === id)[0]
    const bundleWithNewUri = uri ? Object.assign({}, bundle) : Object.assign({}, bundle, { uri })
    if(nosave){
        return config.bundleListingManager.addBundle(bundleWithNewUri)
    }
    const bundleWithPath = Object.assign({}, bundleWithNewUri, { path: bundle.uri as string})
    const bun = await clib.bundle.bundle(bundleWithPath as bundle.BundleMeta, storage)
    bun.uri = uri
    return config.bundleListingManager.addBundle(bun)
}