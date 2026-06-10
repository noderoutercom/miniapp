// index.js — boot: register screens and start router
import * as router from "./lib/router.js";
import { mount as dashboardMount } from "./screens/dashboard/view.js";

const root = document.querySelector("#inv-screen-root");

router.register("dashboard", dashboardMount);
router.start(root);
