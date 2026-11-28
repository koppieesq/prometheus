// Run by `prm monitor sync` inside the Kuma container, where socket.io-client is installed (working dir /app).
// It talks to Kuma the way its web UI does: log in, read the monitor list, add what is missing.
//
// stdin, one item per line, tab-separated (prm writes it):
//   auth  <username>  <password>  [<2fa token>]
//   group <name>
//   http  <name>  <url>  <accepted status range, e.g. 200-299>
//   docker <container name>
// Every http/docker line belongs to the group above it. Nothing is ever changed or deleted: an existing
// group, or a monitor with the same name in that group, is left as it is.
"use strict";
const { io } = require("socket.io-client");

const DOCKER_HOST = { name: "prometheus", url: "http://docker-api:2375" };

// The web UI's defaults for a new monitor (Kuma 2, EditMonitor.vue), minus its display-only fields.
const DEFAULTS = {
    type: "http", name: "", parent: null, url: "https://", wsSubprotocol: "", method: "GET", protocol: null,
    location: "world", ipFamily: null, interval: 60, retryInterval: 60, resendInterval: 0, maxretries: 1,
    retryOnlyOnStatusCodeFailure: false, notificationIDList: {}, ignoreTls: false, upsideDown: false,
    expiryNotification: true, domainExpiryNotification: true, maxredirects: 10, accepted_statuscodes: ["200-299"],
    saveResponse: false, saveErrorResponse: true, responseMaxLength: 1024, dns_resolve_type: "A",
    dns_resolve_server: "", docker_container: "", docker_host: null, proxyId: null, basic_auth_user: "",
    basic_auth_pass: "", bearer_token: "", mqttUsername: "", mqttPassword: "", mqttTopic: "", mqttWebsocketPath: "",
    mqttSuccessMessage: "", mqttCheckType: "keyword", authMethod: null, oauth_auth_method: "client_secret_basic",
    httpBodyEncoding: "json", kafkaProducerBrokers: [], kafkaProducerSaslOptions: { mechanism: "None" },
    cacheBust: false, kafkaProducerSsl: false, kafkaProducerAllowAutoTopicCreation: false,
    gamedigGivenPortOnly: true, gamedigToken: "", remote_browser: null, screenshot_delay: 0, rabbitmqNodes: [],
    rabbitmqUsername: "", rabbitmqPassword: "", conditions: [], system_service_name: "", sshAuthMethod: "password",
    ntpStratumThreshold: 5, ntpTimeOffsetThreshold: 1000, ntpRootDispersionThreshold: 500,
};

function parse(text) {
    let auth = null;
    const groups = [];
    for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        const f = line.split("\t");
        if (f[0] === "auth") auth = { username: f[1], password: f[2], token: f[3] || "" };
        else if (f[0] === "group") groups.push({ name: f[1], items: [] });
        else if (f[0] === "http") groups.at(-1).items.push({ type: "http", name: f[1], url: f[2], accepted: f[3] });
        else if (f[0] === "docker") groups.at(-1).items.push({ type: "docker", name: f[1], container: f[1] });
        else throw new Error(`unexpected input line: ${f[0]}`);
    }
    if (!auth) throw new Error("no credentials given");
    return { auth, groups };
}

async function main() {
    const { auth, groups } = parse(require("fs").readFileSync(0, "utf8"));
    const socket = io("http://127.0.0.1:3001", { transports: ["websocket"], reconnection: false });
    const state = { monitors: null, dockerHosts: null, notifications: [] };
    socket.on("monitorList", (list) => { state.monitors = list; });
    socket.on("updateMonitorIntoList", (list) => { Object.assign(state.monitors ?? (state.monitors = {}), list); });
    socket.on("dockerHostList", (list) => { state.dockerHosts = list; });
    socket.on("notificationList", (list) => { state.notifications = list; });

    const call = (event, ...args) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Kuma did not answer '${event}'`)), 30000);
        socket.emit(event, ...args, (res) => { clearTimeout(timer); resolve(res); });
    });
    const until = async (test, what) => {
        for (let i = 0; i < 100 && !test(); i++) await new Promise((r) => setTimeout(r, 100));
        if (!test()) throw new Error(`Kuma did not send ${what}`);
    };

    await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", (e) => reject(new Error(`cannot reach Kuma on port 3001: ${e.message}`)));
    });
    const login = await call("login", { username: auth.username, password: auth.password, token: auth.token });
    if (login.tokenRequired) throw new Error("this account uses 2FA: set PRM_KUMA_TOKEN to a current code and run it again");
    if (!login.ok) throw new Error(`login failed: ${login.msg}`);
    await until(() => state.monitors && state.dockerHosts, "the monitor and Docker host lists");

    let host = state.dockerHosts.find((h) => h.dockerDaemon === DOCKER_HOST.url);
    if (host) {
        console.log(`  docker host '${host.name}' (${host.dockerDaemon}) already there`);
    } else {
        const res = await call("addDockerHost", { name: DOCKER_HOST.name, dockerType: "tcp", dockerDaemon: DOCKER_HOST.url }, null);
        if (!res.ok) throw new Error(`adding the Docker host: ${res.msg}`);
        host = { id: res.id };
        console.log(`+ docker host '${DOCKER_HOST.name}' (${DOCKER_HOST.url})`);
    }

    // Notifications marked "Default enabled" in Kuma are attached to new monitors, as the UI does.
    const notificationIDList = {};
    for (const n of state.notifications) if (n.isDefault) notificationIDList[n.id] = true;

    let added = 0;
    const add = async (monitor) => {
        const res = await call("add", { ...DEFAULTS, notificationIDList, ...monitor });
        if (!res.ok) throw new Error(`adding '${monitor.name}': ${res.msg}`);
        added++;
        return res.monitorID;
    };
    const existing = () => Object.values(state.monitors);

    for (const g of groups) {
        let group = existing().find((m) => m.type === "group" && m.name === g.name && !m.parent);
        let groupID;
        if (group) {
            groupID = group.id;
            console.log(`  ${g.name}`);
        } else {
            groupID = await add({ type: "group", name: g.name });
            console.log(`+ ${g.name}`);
        }
        for (const item of g.items) {
            if (existing().some((m) => m.parent === groupID && m.name === item.name)) {
                console.log(`    ${item.name}`);
                continue;
            }
            if (item.type === "http") {
                await add({ type: "http", name: item.name, url: item.url, parent: groupID, accepted_statuscodes: [item.accepted] });
            } else {
                await add({ type: "docker", name: item.name, docker_container: item.container, docker_host: host.id, parent: groupID });
            }
            console.log(`  + ${item.name}`);
        }
    }
    console.log(added ? `added ${added} (+ new, the rest were already there)` : "nothing to add: Kuma already has all of it");
    socket.close();
}

main().catch((e) => { console.error(`prm monitor sync: ${e.message}`); process.exit(1); });
