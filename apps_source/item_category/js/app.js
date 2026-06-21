// js/app.js — boot: register screens and start router
import * as router from "./router.js";
import { mount as dashboardMount } from "./components/dashboard.js";
import { mount as formMount }      from "./components/form.js";

const root = document.querySelector("#ic-screen-root");

router.register("dashboard", dashboardMount);
router.register("form",      formMount);
router.start(root);
