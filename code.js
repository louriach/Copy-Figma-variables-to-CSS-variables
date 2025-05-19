"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// Polyfill for padStart.
function padStartPolyfill(str, targetLength, padString = " ") {
    targetLength = targetLength >> 0; // floor if number or convert non-number to 0
    if (str.length >= targetLength) {
        return str;
    }
    else {
        targetLength = targetLength - str.length;
        if (targetLength > padString.length) {
            padString += padString.repeat(Math.ceil(targetLength / padString.length));
        }
        return padString.slice(0, targetLength) + str;
    }
}
// Provided type guard to check if a value is a Variable Alias.
function isVariableAlias(value) {
    return value && typeof value === "object" && value.type === "VARIABLE_ALIAS";
}
// Type guard to check if a value is an RGB(A) object.
function isRGBorRGBA(value) {
    return value && typeof value === "object" && "r" in value && "g" in value && "b" in value;
}
/**
 * Helper function: Converts an RGB/RGBA color to a hex string if fully opaque.
 * Otherwise returns an rgba() string with the alpha value rounded to two decimal places.
 */
function convertColorToCSS(rawValue) {
    if (!isRGBorRGBA(rawValue))
        return rawValue.toString();
    const r = Math.round(rawValue.r * 255);
    const g = Math.round(rawValue.g * 255);
    const b = Math.round(rawValue.b * 255);
    const alpha = ("a" in rawValue ? rawValue.a : 1);
    if (alpha === 1) {
        // Fully opaque - convert to hex using the polyfill.
        const rHex = padStartPolyfill(r.toString(16), 2, "0");
        const gHex = padStartPolyfill(g.toString(16), 2, "0");
        const bHex = padStartPolyfill(b.toString(16), 2, "0");
        return `#${rHex}${gHex}${bHex}`;
    }
    else {
        // Not fully opaque, use rgba() with alpha fixed to two decimal places.
        return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
    }
}
/**
 * Returns a display value for a variable in a specific mode.
 * Uses the variable’s raw values (valuesByMode).
 * If the raw value is an alias, returns "alias:" prefixed to the alias variable’s name.
 * Otherwise, it converts the value.
 */
function getVariableDisplayValueForMode(variable, modeId) {
    return __awaiter(this, void 0, void 0, function* () {
        const rawValues = (variable).valuesByMode;
        if (!rawValues || !(modeId in rawValues))
            return "N/A";
        const rawValue = rawValues[modeId];
        if (isVariableAlias(rawValue)) {
            const aliasVar = yield figma.variables.getVariableByIdAsync(rawValue.id);
            if (aliasVar) {
                if (aliasVar.resolvedType === "COLOR") {
                    const aliasRawValues = (aliasVar).valuesByMode;
                    let colorValue = "";
                    if (aliasRawValues && aliasRawValues[modeId]) {
                        colorValue = convertColorToCSS(aliasRawValues[modeId]);
                    }
                    // Return alias with a delimiter separating the alias name and the color.
                    return "alias:" + aliasVar.name + colorValue;
                }
                return "alias:" + aliasVar.name;
            }
            return "alias:Unknown";
        }
        else {
            switch (variable.resolvedType) {
                case "COLOR":
                    return convertColorToCSS(rawValue);
                case "STRING":
                case "FLOAT":
                case "BOOLEAN":
                    return rawValue.toString();
                default:
                    return rawValue.toString();
            }
        }
    });
}
/**
 * Scans all local variables and returns for each variable an object that includes:
 *    - name: the variable’s name
 *    - collectionId: the collection to which it belongs
 *    - modeValues: an object mapping mode IDs to the variable’s display value in that mode.
 */
function scanVariablesByMode() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const localVariables = yield figma.variables.getLocalVariablesAsync();
            const result = [];
            for (const variable of localVariables) {
                const collectionId = variable.variableCollectionId || "";
                const modeValues = {};
                const rawValues = variable.valuesByMode;
                if (rawValues) {
                    const modeIds = Object.keys(rawValues);
                    for (const modeId of modeIds) {
                        modeValues[modeId] = yield getVariableDisplayValueForMode(variable, modeId);
                    }
                }
                // Here we assume that the variable may contain a "codeSyntax" property.
                const codeSyntax = variable.codeSyntax || "";
                result.push({ name: variable.name, collectionId, modeValues, codeSyntax });
            }
            return result;
        }
        catch (error) {
            figma.ui.postMessage({
                type: "error",
                message: "Error scanning variables by mode: " +
                    (error instanceof Error ? error.message : "Unknown error"),
            });
            return [];
        }
    });
}
/**
 * Retrieves available variable collections and maps necessary data:
 *    - id, name, and modes (each mode has modeId and name).
 */
function getAvailableCollections() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const collections = yield figma.variables.getLocalVariableCollectionsAsync();
            return collections.map((collection) => ({
                id: collection.id,
                name: collection.name,
                modes: collection.modes ? collection.modes.map((mode) => ({ modeId: mode.modeId, name: mode.name })) : [],
            }));
        }
        catch (error) {
            figma.ui.postMessage({
                type: "error",
                message: "Error retrieving collections: " +
                    (error instanceof Error ? error.message : "Unknown error"),
            });
            return [];
        }
    });
}
// Main entry point.
(() => __awaiter(void 0, void 0, void 0, function* () {
    // Show the UI with an increased height for additional controls.
    figma.showUI(__html__, { width: 480, height: 600 });
    const variablesByMode = yield scanVariablesByMode();
    const availableCollections = yield getAvailableCollections();
    // Send the initial data (variables and collections) to the UI.
    figma.ui.postMessage({
        type: "init-data",
        variables: variablesByMode,
        collections: availableCollections,
    });
    figma.ui.onmessage = (msg) => {
        if (msg.type === "create-css") {
            const { selectedRoot, selectedTheme, useCodeSyntax } = msg; // new: useCodeSyntax flag
            let cssLines = [];
            // Build the :root block using variables from the selected root collection.
            cssLines.push(":root {");
            const rootVars = variablesByMode.filter(v => v.collectionId === selectedRoot);
            const rootColl = availableCollections.find(c => c.id === selectedRoot);
            let defaultModeId = "";
            if (rootColl && rootColl.modes.length > 0) {
                defaultModeId = rootColl.modes[0].modeId;
            }
            rootVars.forEach(variable => {
                const cssName = variable.name.replace(/\s+/g, "-").toLowerCase();
                // New: use codeSyntax when requested.
                let value = "";
                if (useCodeSyntax && variable.codeSyntax) {
                    value = variable.codeSyntax;
                }
                else {
                    value = defaultModeId ? variable.modeValues[defaultModeId] || "" : "";
                    if (value.startsWith("alias:")) {
                        let aliasName = value.slice(6);
                        aliasName = aliasName.replace(/\s+/g, "-").toLowerCase();
                        value = `var(--${aliasName})`;
                    }
                }
                cssLines.push(`  --${cssName}: ${value};`);
            });
            cssLines.push("}");
            cssLines.push("");
            // Build the data-theme blocks using variables from the selected theme collection.
            const themeColl = availableCollections.find(c => c.id === selectedTheme);
            if (themeColl && themeColl.modes.length > 0) {
                const themeVars = variablesByMode.filter(v => v.collectionId === selectedTheme);
                themeColl.modes.forEach(mode => {
                    const themeName = mode.name.replace(/\s+/g, "-").toLowerCase();
                    cssLines.push(`[data-theme="${themeName}"] {`);
                    themeVars.forEach(variable => {
                        const cssName = variable.name.replace(/\s+/g, "-").toLowerCase();
                        let value = "";
                        if (useCodeSyntax && variable.codeSyntax) {
                            value = variable.codeSyntax;
                        }
                        else {
                            value = variable.modeValues[mode.modeId] || "";
                            if (value.startsWith("alias:")) {
                                let aliasName = value.slice(6);
                                aliasName = aliasName.replace(/\s+/g, "-").toLowerCase();
                                value = `var(--${aliasName})`;
                            }
                        }
                        cssLines.push(`  --${cssName}: ${value};`);
                    });
                    cssLines.push("}");
                    cssLines.push("");
                });
            }
            const cssVariables = cssLines.join("\n");
            figma.ui.postMessage({
                type: "display-css",
                css: cssVariables,
            });
        }
        else if (msg.type === "close-plugin") {
            figma.closePlugin();
        }
    };
}))();
