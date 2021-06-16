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
import levenshtein from "js-levenshtein";
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
const processedDir = path.join(__dirname, "../config/devices");
const rootDir = path.join(__dirname, "../../../");

const manuToProcess = program.folder;
const dir = path.join(processedDir, manuToProcess);

const templateName = program.template;
const templatePath = `templates/${templateName}`;

let jsonData = {};
let manuTemplateData;
let followUpList = {};

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

			let importName: unknown = "";
			const importNamePath = `${templatePath}#${importName}`;
			for (const testDevice in jsonData) {
				// Skip the current file
				if (device === testDevice) {
					continue;
				}

				for (const testNum in jsonData[testDevice].paramInformation) {
					// Skip if its already an import
					if (
						jsonData[testDevice].paramInformation[testNum].$import
					) {
						continue;
					}

					// Identical parameters, so don't prompt at all
					if (
						degreeOfSimilarity(
							num,
							jsonData[device].paramInformation[num],
							testNum,
							jsonData[testDevice].paramInformation[testNum],
						) === "identical"
					) {
						importName = await addTemplate(
							importName,
							device,
							num,
							testDevice,
							testNum,
						);
					}
					// Prompt for confirmation for all others
					else if (
						degreeOfSimilarity(
							num,
							jsonData[device].paramInformation[num],
							testNum,
							jsonData[testDevice].paramInformation[testNum],
						) === "high" ||
						degreeOfSimilarity(
							num,
							jsonData[device].paramInformation[num],
							testNum,
							jsonData[testDevice].paramInformation[testNum],
						) === "medium"
					) {
						console.clear();
						console.log(
							`Comparing ${jsonData[device].label}, parameter ${num} with ${jsonData[testDevice].label}, parameter ${testNum}`,
						);
						compareParamsOnConsole(
							jsonData[testDevice].paramInformation[testNum],
							jsonData[device].paramInformation[num],
						);

						const isMatch: boolean = await promptToAdd(
							testDevice,
							testNum,
						);
						if (isMatch) {
							importName = await addTemplate(
								importName,
								device,
								num,
								testDevice,
								testNum,
							);
						}
					}
					// Template but retain the tested file's defaultValue
					else if (
						degreeOfSimilarity(
							num,
							jsonData[device].paramInformation[num],
							testNum,
							jsonData[testDevice].paramInformation[testNum],
						) === "high-default" ||
						degreeOfSimilarity(
							num,
							jsonData[device].paramInformation[num],
							testNum,
							jsonData[testDevice].paramInformation[testNum],
						) === "medium-default"
					) {
						console.clear();
						console.clear();
						console.log(
							`Comparing ${jsonData[device].label}, parameter ${num} with ${jsonData[testDevice].label}, parameter ${testNum}`,
						);
						compareParamsOnConsole(
							jsonData[testDevice].paramInformation[testNum],
							jsonData[device].paramInformation[num],
						);
						console.log();
						console.log(
							"Note: The tested file's defaultValue will be retained.",
						);

						const isMatch: boolean = await promptToAdd(
							testDevice,
							testNum,
						);
						if (isMatch) {
							const saveDefault =
								jsonData[testDevice].paramInformation[testNum]
									.defaultValue;
							importName = await addTemplate(
								importName,
								device,
								num,
								testDevice,
								testNum,
							);
							jsonData[testDevice].paramInformation[
								testNum
							].defaultValue = saveDefault;
						}
					}
					// Template but retain the tested file's valueSize
					else if (
						degreeOfSimilarity(
							num,
							jsonData[device].paramInformation[num],
							testNum,
							jsonData[testDevice].paramInformation[testNum],
						) === "high-value" ||
						degreeOfSimilarity(
							num,
							jsonData[device].paramInformation[num],
							testNum,
							jsonData[testDevice].paramInformation[testNum],
						) === "medium-value"
					) {
						console.clear();
						console.clear();
						console.log(
							`Comparing ${jsonData[device].label}, parameter ${num} with ${jsonData[testDevice].label}, parameter ${testNum}`,
						);
						compareParamsOnConsole(
							jsonData[testDevice].paramInformation[testNum],
							jsonData[device].paramInformation[num],
						);
						console.log();
						console.log(
							"Note: The tested file's valueSize will be retained.",
						);

						const isMatch: boolean = await promptToAdd(
							testDevice,
							testNum,
						);
						if (isMatch) {
							const saveValue =
								jsonData[testDevice].paramInformation[testNum]
									.valueSize;
							importName = await addTemplate(
								importName,
								device,
								num,
								testDevice,
								testNum,
							);
							jsonData[testDevice].paramInformation[
								testNum
							].valueSize = saveValue;
						}
					}
				}
			}
			console.log(`Finished: Group ${groupNum}`);
			// Template first device
			if (importName.length > 0) {
				if (jsonData[device].paramInformation[num].$if) {
					const tempIf = jsonData[device].paramInformation[num].$if;
					jsonData[device].paramInformation[num] = {};
					jsonData[device].paramInformation[num].$if = tempIf;
					// eslint-disable-next-line prettier/prettier
					jsonData[device].paramInformation[
						num
					].$import = importNamePath;
				} else {
					jsonData[device].paramInformation[num] = {};
					// eslint-disable-next-line prettier/prettier
					jsonData[device].paramInformation[
						num
					].$import = importNamePath;
				}
			}
			groupNum++;
		}
		console.log(`Device Complete: ${jsonData[device].label}`);
	}

	// Write the files
	await writeFiles();
	console.log("Finished");
}

async function promptUser(query: string) {
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

async function promptToAdd(testDevice: string, testNum: string) {
	const response = await promptUser(
		"(A)dd template reference, (s)kip, (f)ollow-up, or (q)uit? ",
	);

	if (response == "Q" || response == "q") {
		await writeFiles();
		process.exit();
	} else if (response == "f" || response == "f") {
		followUpList[testDevice] = followUpList[testDevice] || {};
		followUpList[testDevice][testNum] =
			jsonData[testDevice].paramInformation[testNum];

		const note = await promptUser("Note: ");
		followUpList[testDevice][testNum].note = response;
		return false;
	} else if (response === "s" || response === "S") {
		return false;
	} else {
		return true;
	}
}

async function addTemplate(
	importName: unknown,
	device: string,
	num: string,
	testDevice: string,
	testNum: string,
) {
	if (!importName) {
		importName = await promptUser(
			"Adding new template reference - Import statement name? ",
		);

		// Add to manufacturer template
		manuTemplateData[importName] = jsonData[device].paramInformation[num];
	}
	const importNamePath = `${templatePath}#${importName}`;

	// Template matching device, maintaining any conditions
	if (jsonData[testDevice].paramInformation[testNum].$if) {
		const tempIf = jsonData[testDevice].paramInformation[testNum].$if;
		jsonData[testDevice].paramInformation[testNum] = {};
		jsonData[testDevice].paramInformation[testNum].$if = tempIf;
		jsonData[testDevice].paramInformation[testNum].$import = importNamePath;
	} else {
		jsonData[testDevice].paramInformation[testNum] = {};
		jsonData[testDevice].paramInformation[testNum].$import = importNamePath;
	}

	return importName;
}

function degreeOfSimilarity(
	originalNum: string,
	originalParam: Record<string, unknown>,
	testNum: string,
	testParam: Record<string, unknown>,
) {
	const normalizedDistance =
		levenshtein(originalParam.label, testParam.label) /
		Math.max(originalParam.label.length, testParam.label.length);

	if (
		originalParam.label === testParam.label &&
		originalParam.minValue === testParam.minValue &&
		originalParam.maxValue === testParam.maxValue &&
		originalParam.defaultValue === testParam.defaultValue &&
		originalParam.valueSize === testParam.valueSize
	) {
		return "identical";
	} else if (
		originalNum === testNum &&
		originalParam.minValue === testParam.minValue &&
		originalParam.maxValue === testParam.maxValue &&
		originalParam.defaultValue === testParam.defaultValue &&
		originalParam.valueSize === testParam.valueSize
	) {
		return "high";
	} else if (
		originalNum === testNum &&
		originalParam.minValue === testParam.minValue &&
		originalParam.maxValue === testParam.maxValue &&
		originalParam.valueSize === testParam.valueSize
	) {
		return "high-default";
	} else if (
		originalNum === testNum &&
		originalParam.minValue === testParam.minValue &&
		originalParam.maxValue === testParam.maxValue &&
		originalParam.defaultValue === testParam.defaultValue
	) {
		return "high-value";
	} else if (
		normalizedDistance < 0.2 &&
		originalParam.minValue === testParam.minValue &&
		originalParam.maxValue === testParam.maxValue &&
		originalParam.defaultValue === testParam.defaultValue &&
		originalParam.valueSize === testParam.valueSize
	) {
		return "medium";
	} else if (
		normalizedDistance < 0.2 &&
		originalParam.minValue === testParam.minValue &&
		originalParam.maxValue === testParam.maxValue &&
		originalParam.valueSize === testParam.valueSize
	) {
		return "medium-default";
	} else if (
		normalizedDistance < 0.2 &&
		originalParam.minValue === testParam.minValue &&
		originalParam.maxValue === testParam.maxValue &&
		originalParam.defaultValue === testParam.defaultValue
	) {
		return "medium-value";
	} else {
		return "low";
	}
}

function compareParamsOnConsole(
	originalParam: Record<string, unknown>,
	testParam: Record<string, unknown>,
) {
	const colors = Colors;
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

	// Write our manual follow-up list
	if (Object.keys(followUpList).length > 0) {
		const oFollowUp = JSONC.stringify(followUpList, null, "\t");
		await fs.writeFile(
			`${rootDir}/templateFollowUp.json`,
			oFollowUp,
			"utf8",
		);
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
