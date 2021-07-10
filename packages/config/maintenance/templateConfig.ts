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
	normalizeUnits,
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
let masterTemplateData: { [x: string]: { options: unknown } };
let manuTemplateData;
let followUpList = {};
let templateCounter = 0;
const possibleLocalBase = [];
let firstBaseRun = true;

async function templateParams(): Promise<void> {
	// Initialize the master template
	try {
		const f = await fs.readFile(
			`${processedDir}/templates/master_template.json`,
			"utf8",
		);
		masterTemplateData = JSONC.parse(f);
	} catch (e) {
		console.log(
			`Error processing: ${processedDir}/templates/master_template.json - ${e}`,
		);
	}

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
			jsonData[file] = normalizeConfig(JSONC.parse(j));
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
			let importNamePath = `${templatePath}#${importName}`;
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
						importNamePath = `${templatePath}#${importName}`;
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
							importNamePath = `${templatePath}#${importName}`;
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
							importNamePath = `${templatePath}#${importName}`;
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
							importNamePath = `${templatePath}#${importName}`;
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
					jsonData[device].paramInformation[num].$import =
						importNamePath;
				} else {
					jsonData[device].paramInformation[num] = {};
					// eslint-disable-next-line prettier/prettier
					jsonData[device].paramInformation[num].$import =
						importNamePath;
				}
			}
			groupNum++;
		}
		console.log(`Device Complete: ${jsonData[device].label}`);
	}
}

async function addBases(): Promise<void> {
	const isReady = await promptUser("Ready to add bases? (Y/n)");

	// Confirm the user wants to add bases, or exit
	if (isReady === "n" || isReady === "N") {
		await writeFiles();
		process.exit();
	}

	// Add pre-existing bases to manufacturer file
	console.log("Looking for bases to apply to manufacturer template");
	for (const param in manuTemplateData) {
		// Skip if already templated
		if (manuTemplateData[param].$import) {
			continue;
		}
		manuTemplateData[param] = await applyMasterTemplate(
			manuTemplateData[param],
		);
	}

	// Add pre-existing local bases to template definitions
	for (const param in manuTemplateData) {
		// Skip if already templated
		if (manuTemplateData[param].$import) {
			continue;
		}
		manuTemplateData[param] = await applyLocalTemplate(
			manuTemplateData[param],
		);
	}

	// Add pre-existing bases to device files

	for (const device in jsonData) {
		console.log(`Looking for bases in: ${jsonData[device].label}`);
		for (const num in jsonData[device].paramInformation) {
			// Skip if already templated
			if (jsonData[device].paramInformation[num].$import) {
				continue;
			}

			// Add bases in master template
			try {
				jsonData[device].paramInformation[num] =
					await applyMasterTemplate(
						jsonData[device].paramInformation[num],
						true,
					);
			} catch (e) {
				console.log(
					`Error applying master template: ${device}, parameter ${num} - ${e}`,
				);
			}

			// If not defined in master template, apply potential bases in the manufacturer template
			try {
				jsonData[device].paramInformation[num] =
					await applyLocalTemplate(
						jsonData[device].paramInformation[num],
						true,
					);
			} catch (e) {
				console.log(
					`Error applying local template: ${device}, parameter ${num} - ${e}`,
				);
			}
		}
	}

	// Test for new potential local templates to add
	await testNewBases();

	// Rerun looking for newly added bases, unless we've run before
	if (firstBaseRun) {
		firstBaseRun = false;
		await addBases();
	}
}

async function applyMasterTemplate(
	testParam: Record<string, unknown>,
	device_file: boolean = false,
) {
	for (const mParam in masterTemplateData) {
		const newParam = {};
		if (
			mParam.match(/^base/i) &&
			masterTemplateData[mParam].minValue === testParam.minValue &&
			masterTemplateData[mParam].maxValue === testParam.maxValue
		) {
			compareParamsOnConsole(testParam, masterTemplateData[mParam]);
			console.log();
			console.log(`Should we add the template: ${mParam}`);
			const addTemplate: boolean = await promptToAdd(
				"potential_template",
				templateCounter.toString(),
			);
			if (addTemplate) {
				newParam.$if = testParam.$if || "";
				if (device_file) {
					newParam.$import = `../templates/master_template.json#${mParam}`;
				} else {
					newParam.$import = `../../templates/master_template.json#${mParam}`;
				}
				newParam.label = testParam.label || "";
				newParam.description = testParam.description || "";
				newParam.valueSize =
					testParam.valueSize !== masterTemplateData[mParam].valueSize
						? testParam.valueSize
						: "";
				newParam.unit =
					(testParam.unit !== testParam.unit) !==
					masterTemplateData[mParam].unit
						? testParam.unit
						: "";
				newParam.defaultValue =
					testParam.defaultValue !==
					masterTemplateData[mParam].defaultValue
						? testParam.defaultValue
						: "";
				newParam.allowManualEntry =
					testParam.allowManualEntry !==
					masterTemplateData[mParam].allowManualEntry
						? testParam.allowManualEntry
						: "";
				newParam.options =
					testParam.options !== masterTemplateData[mParam].options
						? testParam.options
						: "";
				return newParam;
			}
		}
	}
	return testParam;
}

async function applyLocalTemplate(
	testParam: Record<string, unknown>,
	device_file: boolean = false,
) {
	const newParam = {};

	for (const manuParam in manuTemplateData) {
		if (
			manuParam.match(/^base/i) &&
			manuTemplateData[manuParam].minValue === testParam.minValue &&
			manuTemplateData[manuParam].maxValue === testParam.maxValue
		) {
			compareParamsOnConsole(testParam, manuTemplateData[manuParam]);
			templateCounter = templateCounter + 1;
			console.log();
			console.log(`Should we add the template: ${manuParam}`);
			const addTemplate: boolean = await promptToAdd(
				"potential_template",
				templateCounter.toString(),
			);

			if (addTemplate) {
				newParam.$if = testParam.$if || "";
				if (device_file) {
					newParam.$import = `templates/${templateName}#${manuParam}`;
				} else {
					newParam.$import = `#${manuParam}`;
				}
				newParam.label = testParam.label || "";
				newParam.description = testParam.description || "";
				newParam.valueSize =
					testParam.valueSize !==
					manuTemplateData[manuParam].valueSize
						? testParam.valueSize
						: "";
				newParam.defaultValue =
					testParam.defaultValue !==
					manuTemplateData[manuParam].defaultValue
						? testParam.defaultValue
						: "";
				newParam.allowManualEntry =
					testParam.allowManualEntry !==
					manuTemplateData[manuParam].allowManualEntry
						? testParam.allowManualEntry
						: "";
				newParam.options =
					testParam.options !== manuTemplateData[mParam].options
						? testParam.options
						: "";
				return newParam;
			}
		} else if (testParam.minValue && testParam.maxValue) {
			// Add to the list to be potentially added as a base in the future
			possibleLocalBase.push({
				valueSize: testParam.valueSize,
				minValue: testParam.minValue,
				maxValue: testParam.maxValue,
				defaultValue: testParam.defaultValue,
				allowManualEntry: testParam.allowManualEntry,
				options: testParam.options,
			});
		}
	}
	return testParam;
}

async function testNewBases() {
	for (const [index, entry] of possibleLocalBase.entries()) {
		let importName: unknown = "";
		for (const [testIndex, testEntry] of possibleLocalBase.entries()) {
			// Skip the current entry
			if (index === testIndex) {
				continue;
			}

			if (
				entry.minValue === testEntry.minValue &&
				entry.maxValue === testEntry.maxValue &&
				entry.allowManualEntry === testEntry.allowManualEntry &&
				entry.options === testEntry.options
			) {
				compareParamsOnConsole(entry, testEntry);
				templateCounter = templateCounter + 1;
				const addTemplate: boolean = await promptToAdd(
					"potential_template",
					templateCounter.toString(),
				);

				if (addTemplate) {
					if (!importName) {
						console.clear();
						console.log(entry);
						importName = await promptUser(
							"Adding new template reference - Import statement name? ",
						);

						// Add to manufacturer template
						manuTemplateData[importName] = entry;
					}

					// Delete the one we've added
					possibleLocalBase[testIndex] = "";
				}
			}
		}

		// Delete the one we've been testing
		possibleLocalBase[index] = "";
	}
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
	} else if (response == "B" || response == "b") {
		await addBases();
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
		console.clear();
		console.log(jsonData[device].paramInformation[num]);
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
		normalizedDistance < 0.15 &&
		originalParam.minValue === testParam.minValue &&
		originalParam.maxValue === testParam.maxValue &&
		originalParam.defaultValue === testParam.defaultValue &&
		originalParam.valueSize === testParam.valueSize
	) {
		return "medium";
	} else if (
		normalizedDistance < 0.15 &&
		originalParam.minValue === testParam.minValue &&
		originalParam.maxValue === testParam.maxValue &&
		originalParam.valueSize === testParam.valueSize
	) {
		return "medium-default";
	} else if (
		normalizedDistance < 0.15 &&
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

function normalizeParameters() {
	// Parameter key order (comments preserved)
	const paramOrder = [
		"$if",
		"$import",
		"label",
		"description",
		"valueSize",
		"unit",
		"minValue",
		"maxValue",
		"defaultValue",
		"unsigned",
		"readOnly",
		"writeOnly",
		"allowManualEntry",
		"options",
	];

	for (const [key, original] of Object.entries<any>(manuTemplateData)) {
		original.unit = original.unit || "";
		original.unit = normalizeUnits(original.unit);

		if (original.readOnly) {
			original.allowManualEntry = undefined;
			original.writeOnly = undefined;
		} else if (original.writeOnly) {
			original.readOnly = undefined;
		} else {
			original.readOnly = undefined;
			original.writeOnly = undefined;
		}

		if (original.allowManualEntry === true) {
			original.allowManualEntry = undefined;
		}

		// Remove undefined keys while preserving comments
		for (const l of paramOrder) {
			if (original[l] == undefined || original[l] === "") {
				delete original[l];
				continue;
			}

			const temp = original[l];
			delete original[l];
			original[l] = temp;
		}

		// Delete empty options arrays
		if (original.options?.length === 0) {
			delete original.options;
		}
	}
}

async function writeFiles() {
	// Normalize template files
	normalizeParameters();

	// Write the master template file
	const oMasterTemplate = JSONC.stringify(masterTemplateData, null, "\t");
	await fs.writeFile(
		`${processedDir}/templates/master_template.json`,
		oMasterTemplate,
		"utf8",
	);

	// Write the manufacturer template file
	await fs.ensureDir(`${dir}/templates`);
	const oManuTemplate = JSONC.stringify(manuTemplateData, null, "\t");
	await fs.writeFile(
		`${dir}/templates/${templateName}`,
		oManuTemplate,
		"utf8",
	);

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
	await addBases();

	// Write the files
	await writeFiles();
	console.log("Finished");
})();
