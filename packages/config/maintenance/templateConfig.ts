/*!
 * This script is used to template the device configuration files
 */

process.on("unhandledRejection", (r) => {
	throw r;
});

import { enumFilesRecursive } from "@zwave-js/shared";
import * as Colors from "colors";
import * as JSONC from "comment-json";
import * as Diff from "diff";
import * as fs from "fs-extra";
import * as path from "path";
import yargs from "yargs";
import {
	downloadDevicesZWA,
	normalizeConfig,
	parseZWAFiles,
	retrieveZWADeviceIds,
} from "./importConfig";

const program = yargs
	.option("folder", {
		description: "folder to template",
		alias: "f",
		type: "string",
	})
	.option("template", {
		description: "Name of the manufacturer-specific template file",
		alias: "t",
		type: "string",
	})
	.option("download", {
		alias: "D",
		description: "Download devices DB from ZWA",
		type: "boolean",
	})
	.option("zmanufacturer", {
		alias: "z",
		description: "ZWA website manufacturer ID",
		type: "number",
	})
	.example(
		"template -f 0x0063 -t ge_template.json -D -z 356",
		"Download and template the GE folder",
	)
	.help()
	.version(false)
	.alias("h", "help").argv;

// Where the files are located
const processedDir = path.join(
	__dirname,
	"../../../packages/config",
	"config/devices",
);

const manuToProcess = program.folder;
const dir = path.join(processedDir, manuToProcess);

const templateName = program.template;
const templatePath = `templates/${templateName}`;

let jsonData = {};
let manuTemplateData;

async function templateParams(): Promise<void> {
	// Initiliaze the manufacturer template
	if (fs.existsSync(`${dir}/templates/${templateName}`)) {
		const f = await fs.readFile(`${dir}/templates/${templateName}`, "utf8");
		try {
			manuTemplateData = JSONC.parse(f);
		} catch (e) {
			console.log(
				`Error processing: ${dir}/templates/${templateName} - ${e}`,
			);
		}
	} else {
		manuTemplateData = {};
	}

	// Build the list of device files
	const configFiles = await enumFilesRecursive(dir, (file) =>
		file.endsWith(".json"),
	);
	for (const file of configFiles) {
		const j = await fs.readFile(file, "utf8");

		try {
			jsonData[file] = JSONC.parse(j);
		} catch (e) {
			console.log(`Error processing: ${file} - ${e}`);
		}
	}

	// Remove devices with no parameters
	for (const device in jsonData) {
		if (!jsonData[device].paramInformation) {
			delete jsonData[device];
		}
	}

	let groupNum = 0;

	for (const device in jsonData) {
		let inTemplate = false;
		for (const num in jsonData[device].paramInformation) {
			// Skip if its already an import
			if (jsonData[device].paramInformation[num].$import) {
				continue;
			}

			let importName;
			let importNamePath;
			for (const testDevice in jsonData) {
				// Skip the current file
				if (device === testDevice) {
					continue;
				}

				for (const testNum in jsonData[testDevice].paramInformation) {
					let isMatch = false;

					// Skip if its already an import
					if (
						jsonData[testDevice].paramInformation[testNum].$import
					) {
						continue;
					}

					// Always consider the same parameter number
					if (
						num === testNum &&
						jsonData[device].paramInformation[num].minValue ===
							jsonData[testDevice].paramInformation[testNum]
								.minValue &&
						jsonData[device].paramInformation[num].maxValue ===
							jsonData[testDevice].paramInformation[testNum]
								.maxValue &&
						jsonData[device].paramInformation[num].defaultValue ===
							jsonData[testDevice].paramInformation[testNum]
								.defaultValue &&
						jsonData[device].paramInformation[num].valueSize ===
							jsonData[testDevice].paramInformation[testNum]
								.valueSize
					) {
						console.clear();
						compareParamsOnConsole(
							jsonData[testDevice].paramInformation[testNum],
							jsonData[device].paramInformation[num],
						);
						const response = await askQuestion(
							"Equivalent Parameter (Y/n)? ",
						);

						if (response === "wq") {
							console.log("Quitting!");
							// Write the files
							await writeFiles();
							return;
						} else if (response !== "n" && response !== "N") {
							console.log("Adding!");
							isMatch = true;
						}
					}

					if (isMatch) {
						if (!inTemplate) {
							if (!importName) {
								importName = await askQuestion(
									"Import statement name? ",
								);
							}
							importNamePath = `${templatePath}#${importName}`;

							// Add to manufacturer template
							manuTemplateData[importName] =
								jsonData[device].paramInformation[num];

							// Template matching device
							jsonData[testDevice].paramInformation[testNum] = {};
							jsonData[testDevice].paramInformation[
								testNum
							].$import = importNamePath;

							inTemplate = true;
						} else {
							// Template matching device
							jsonData[testDevice].paramInformation[testNum] = {};
							jsonData[testDevice].paramInformation[
								testNum
							].$import = importNamePath;
						}
					}
				}
			}
			console.log(`Finished: Group ${groupNum}`);
			// Template first device
			if (importNamePath) {
				jsonData[device].paramInformation[num] = {};
				jsonData[device].paramInformation[num].$import = importNamePath;
			}
			inTemplate = false;
			groupNum++;
		}
		console.log(`Device Complete: ${jsonData[device].label}`);
	}

	// Write the files
	await writeFiles();
	console.log("Finished");
}

async function askQuestion(query: string) {
	const readline = await import("readline");
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) =>
		rl.question(query, (ans) => {
			rl.close();
			resolve(ans);
		}),
	);
}

function compareParamsOnConsole(
	originalParam: Record<string, unknown>,
	testParam: Record<string, unknown>,
) {
	const colors = Colors;
	console.clear();
	const diff = Diff.diffLines(
		JSONC.stringify(originalParam, null, "\t"),
		JSONC.stringify(testParam, null, "\t"),
	);

	diff.forEach((part) => {
		const color = part.added ? "green" : part.removed ? "red" : "grey";
		process.stderr.write(part.value[color]);
	});
}

async function writeFiles() {
	// Write the template file
	await fs.ensureDir(`${dir}/templates`);
	const oTemplate = JSONC.stringify(manuTemplateData, null, "\t");
	await fs.writeFile(`${dir}/templates/${templateName}`, oTemplate, "utf8");

	// Write the device files
	for (const device in jsonData) {
		const output = JSONC.stringify(
			normalizeConfig(jsonData[device]),
			null,
			"\t",
		);
		await fs.writeFile(device, output, "utf8");
	}
}

void (async () => {
	if (!program.folder || !program.template) {
		throw new Error("Insufficient arguments provided");
	}

	if (program.download) {
		if (!program.zmanufacturer) {
			throw new Error(
				"ZWA website manufacturer ID must be provided to download files",
			);
		}

		const deviceIds = await retrieveZWADeviceIds(
			false,
			program.zmanufacturer
				?.map((manu) => parseInt(manu as any))
				.filter((num) => !Number.isNaN(num)),
		);
		await downloadDevicesZWA(deviceIds);
		await parseZWAFiles();
	}

	await templateParams();
})();
