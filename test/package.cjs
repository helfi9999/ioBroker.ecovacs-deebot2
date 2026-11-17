/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Thomas H. */

const path = require("node:path");
const { tests } = require("@iobroker/testing");
tests.packageFiles(path.join(__dirname, ".."));
