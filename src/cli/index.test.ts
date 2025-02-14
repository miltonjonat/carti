import * as testUtil from "../test/test_util"
import fs from "fs-extra"
import rimraf from "rimraf"
import {promisify} from "util"
import { spawnSync, SpawnSyncReturns } from "child_process"
import os from "os"

const rmAll = promisify(rimraf)
const version = require("../../package.json").version; // tslint:disable-line

const LOCAL_BASE_TEST_DIR = fs.mkdtempSync(`${os.tmpdir()}/test-carti`)
const LOCAL_TEST_HOME = LOCAL_BASE_TEST_DIR
const LOCAL_TEST_PROJECT_DIR = `${LOCAL_BASE_TEST_DIR}/local-project`

const REMOTE_BASE_TEST_DIR = fs.mkdtempSync(`${os.tmpdir()}/test-carti`)
const REMOTE_TEST_HOME = REMOTE_BASE_TEST_DIR
const REMOTE_TEST_PROJECT_DIR = `${REMOTE_BASE_TEST_DIR}/remote-project`

const createTestEnvironment = (projectDir: string, testHome: string): testUtil.TestEnv => {
    fs.ensureDirSync(projectDir)
    return {
        cwd: projectDir,
        env: { HOME: testHome, PATH: process.env.PATH }
    }
}

const localTestEnvironment = createTestEnvironment(LOCAL_TEST_PROJECT_DIR, LOCAL_TEST_HOME)
const remoteTestEnvironment = createTestEnvironment(REMOTE_TEST_PROJECT_DIR, REMOTE_TEST_HOME)
const contains = (phrase: string) => {
    return (res: SpawnSyncReturns<Buffer>): boolean => {
        if (res.error || !res.stdout)
            throw res.error
        const output = res.stdout.toString()
        return output.match(phrase) !== null
    }
}

const helpCommand = testUtil.createTestCommand("npx carti help", contains("help"))
const setup = (env: testUtil.TestEnv) => {
    // setup environment to install itself in a clean dir
    spawnSync("npm", ["pack"])
    const cartiNodePackage = `createdreamtech-carti-${version}.tgz`
    fs.copyFileSync(`${process.cwd()}/${cartiNodePackage}`, `${env.cwd}/${cartiNodePackage}`)
    fs.copyFileSync(`${__dirname}/../fixtures/dapp-test-data.ext2`, `${env.cwd}/dapp-test-data.ext2`)
    //npm is special and messes with the env
    spawnSync("npm", ["init", "-y"], { cwd: env.cwd })

    const res = spawnSync("npm", ["install", `${env.cwd}/${cartiNodePackage}`], { cwd: env.cwd })
    if (res.error)
        console.error(res.error)

    const result = testUtil.testCommand(helpCommand, env)
    if (result === false) {
        throw new Error("could not setup test")
    }
}
//fs.copyFileSync("../../../fixtures/ram.ext2", localTestEnvironment.cwd
const cartiCmd = (pth: string) => `${pth}/node_modules/.bin/carti`
const { cwd } = localTestEnvironment;
// const cartiCmd="carti"
const testBundleCmdArgs = (dir:string)=>{
    return `${cartiCmd(dir)} bundle -t flashdrive -n dapp-test-data -v 1.0.0 -d hello_world_flash_drive dapp-test-data.ext2`
}

const testBundleCommand =(dir:string)=>{ 
    return testUtil.createTestCommand(testBundleCmdArgs(dir), contains("bundled: dapp-test-data"))
}

const testBundleInstallArgs=(dir:string , bundleName: string) => {
    return `${cartiCmd(dir)} install ${bundleName}`
}

const testBundleInstallCommand=(dir: string, bundleName: string)=> {
    return testUtil.createTestCommand(testBundleInstallArgs(dir, bundleName), () => true) 
}

const diskLocation = (dir:string) =>
    `${dir}/carti_bundles/baenrwic6ybfsdmdtm52fhgbeip6ndoi3e62bonaadmotji4x6vvdpedt3m/dapp-test-data.ext2`
const testPublishCmdArgs = (dir: string, uri: string) => {
    return `${cartiCmd(dir)} publish uri dapp-test-data ${uri}`
}
const testPublishCommand = (dir:string, uri:string) => {
    return testUtil.createTestCommand(testPublishCmdArgs(dir, uri), ()=>true);
}

const testAddRepoCmdArgs = (dir:string, uri:string)=> {
    return `${cartiCmd(dir)} repo add ${uri}`
}

const testAddRepoCommand = (dir:string, uri: string) => {
    return testUtil.createTestCommand(testAddRepoCmdArgs(dir, uri), () => true)
}

const testMachineInitCmdArgs = (dir:string) =>{
    return `${cartiCmd(dir)} machine init`
}

const testMachineInitCommand=(dir:string, check:()=>true = ()=>true) =>{
    return testUtil.createTestCommand(testMachineInitCmdArgs(dir), check)
}

interface AddCmdOptions {
    length: string,
    start: string
}

const testMachineAddCmdArgs = (dir:string, bundleName: string, cmd: AddCmdOptions) => {
    return `${cartiCmd(dir)} machine add flash ${bundleName} --start ${cmd.start} --length ${cmd.length}`
}

const testMachineAddCommand = (dir: string, bundleName: string, cmd: AddCmdOptions) => {
    return testUtil.createTestCommand(testMachineAddCmdArgs(dir, bundleName, cmd), () => true)
}

const testMachineBuildArgs = (dir:string) => {
    return `${cartiCmd(dir)} machine build`
}

const testMachineBuildCommand = (dir: string) => {
    return testUtil.createTestCommand(testMachineBuildArgs(dir), () => true)
}

const testMachineInstallArgs = (dir:string, uri: string) => {
    return `${cartiCmd(dir)} machine install ${uri}`
}

const testMachineInstallCommand = (dir: string, uri:string) => {
    return testUtil.createTestCommand(testMachineInstallArgs(dir, uri), () => true)
}

describe("integration tests for cli", () => {
    afterAll(async ()=>{
        await rmAll(LOCAL_BASE_TEST_DIR)
        await rmAll(REMOTE_BASE_TEST_DIR)
    })
    /*
        The test pattern for this is 
        local builds bundle
        local publishes bundle
        remote installs locals bundle
        remote creates a machine to use bundle
        remote adds custom bundle from local to it's machine
        remote builds machine
        local installs remote's machine creating a stored_machine
    */
    it("should bundle a flash drive, publish it, install it, create a machine, and install the machine", () => {
           setup(localTestEnvironment)
           setup(remoteTestEnvironment)

        const localBundleCmd = testBundleCommand(localTestEnvironment.cwd)
        const publishBundleCmd = testPublishCommand(localTestEnvironment.cwd,
            diskLocation(localTestEnvironment.cwd))
        const addRepoCmd = testAddRepoCommand(remoteTestEnvironment.cwd,
            localTestEnvironment.cwd)
        const installBundleCmd = testBundleInstallCommand(remoteTestEnvironment.cwd,"dapp-test-data")
        const machineInitCmd = testMachineInitCommand(remoteTestEnvironment.cwd, ()=> {

        // NOTE by default the init fills out a config with default settings so you must edit the file specifically
        // for your flash drive, there is a concurrency issue that prevents this from happening.
        // not explicitly after  the command has finished. Hence this inline code here
            const machineFile = fs.readFileSync(`${remoteTestEnvironment.cwd}/carti-machine-package.json`)
            const machineJSON = JSON.parse(machineFile.toString())
            machineJSON.machineConfig.flash_drive = machineJSON.machineConfig.flash_drive
                .filter((flash: any) => { flash.cid !== "default-flash" })
            fs.writeFileSync(`${remoteTestEnvironment.cwd}/carti-machine-package.json`,
                JSON.stringify(machineJSON, null, 2))
            return true;
        })
        const machineAddCmd = testMachineAddCommand(remoteTestEnvironment.cwd, "dapp-test-data", 
            { length: "0x100000", start: "0x8000000000000000" })

        const machineBuildCmd = testMachineBuildCommand(remoteTestEnvironment.cwd)
        const machineInstallCmd = testMachineInstallCommand(localTestEnvironment.cwd, `${remoteTestEnvironment.cwd}/carti-machine-package.json`)
        expect(testUtil.testCommand(localBundleCmd, localTestEnvironment)).toBe(true)
        //otherwise throws exception
        expect(testUtil.testCommand(publishBundleCmd, Object.assign({},localTestEnvironment,{input: "\r\n"}))).toBe(true)
        expect(testUtil.testCommand(addRepoCmd, remoteTestEnvironment)).toBe(true)
        expect(testUtil.testCommand(installBundleCmd, Object.assign({},remoteTestEnvironment,{input:"\r\n"}))).toBe(true)
        expect(testUtil.testCommand(machineInitCmd, remoteTestEnvironment)).toBe(true)
        expect(testUtil.testCommand(machineAddCmd, Object.assign({}, remoteTestEnvironment, { input: "\r\n" }))).toBe(true)
        expect(testUtil.testCommand(machineBuildCmd, remoteTestEnvironment)).toBe(true)
        expect(testUtil.testCommand(machineInstallCmd, localTestEnvironment)).toBe(true)


    })


})