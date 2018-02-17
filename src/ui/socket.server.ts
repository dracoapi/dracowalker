import * as logger from 'winston';
import * as _ from 'lodash';
import * as fastify from 'fastify';

import { enums } from 'draconode';
import Player from '../lib/player';
import GoThereRouter from '../lib/router/GoThereRouter';

/**
 * Socket server to communicate to the web ui through socket.io
 */
export default class SocketServer {
    config: any;
    state: any;
    io: any;
    initialized = false;
    player: Player;

    /**
     * @constructor
     * @param {object} config - global config object
     * @param {object} state - global state object
     */
    constructor(config, state) {
        this.config = config;
        this.state = state;
        this.player = new Player(config, state);
        this.io = {};
    }

    /**
     * Start a socket.io server.
     * @return {Promise}
     */
    start() {
        if (!this.config.ui.enabled) return;

        const app = fastify();
        this.io = require('socket.io')(app.server);

        this.io.on('connection', socket => {
            logger.debug('UI connected.');
            if (this.initialized) this.ready(socket);

            socket.on('inventory_list', () => this.sendInventory(socket));
            socket.on('creature_list', () => this.sendCreatures(socket));
            socket.on('eggs_list', () => this.sendEggs(socket));
            socket.on('player_stats', () => this.sendPlayerStats());
            socket.on('transfer_creature', msg => this.transferCreature(socket, msg));
            socket.on('drop_items', msg => this.dropItems(socket, msg));
            socket.on('evolve_creature', msg => this.evolveCreature(socket, msg));
            socket.on('set_destination', msg => this.setDestination(msg));
        });

        const port = this.config.ui.port || 8000;
        app.listen(port);
        logger.debug('Socket server listening at ' + port);
    }

    /**
     * Send a ready event to the client to say we are ready to go.
     * @param {object} client - optional socket client to send into to
     */
    ready(client?) {
        if (!this.config.ui.enabled) return;
        if (!this.state.player.id) return;

        logger.debug('Send ready message to the ui.');
        const data = {
            username: this.state.player.nickname,
            player: this.state.player.avatar,
            storage: this.state.player.storage,
            pos: this.state.pos,
        };
        if (client) {
            // send initialized event to the newly connect client
            client.emit('initialized', data);
        } else {
            // broadcast that we are ready
            this.initialized = true;
            this.io.emit('initialized', data);
        }
    }

    /**
     * Send position to connected clients
     */
    sendPosition() {
        if (!this.config.ui.enabled) return;
        this.io.emit('position', this.state.pos);
    }

    /**
     * Send route to connected clients
     * @param {object} route - route info
     */
    sendRoute(route) {
        if (!this.config.ui.enabled) return;
        this.io.emit('route', _.concat([this.state.pos], route));
    }

    /**
     * Send available buildings to connected clients
     */
    sendBuildings() {
        if (!this.config.ui.enabled) return;
        this.io.emit('buildings', this.state.map.buildings);
    }

    /**
     * Send a create caught event to connected clients
     * @param {object} creature - the creature we've just caught
     */
    sendCreatureCaught(creature) {
        if (!this.config.ui.enabled) return;
        creature.fullname = enums.CreatureType[creature.name];
        this.io.emit('creature_caught', {
            creature,
            position: this.state.pos,
        });
    }

    sendCreatureEvolve(from, to) {
        if (!this.config.ui.enabled) return;
        this.io.emit('creature_evolved', {
            from,
            to,
        });
    }

    /**
     * Send a pokestop visited event to connected clients
     * @param {object} building - the pokestop we've just visited
     */
    sendVisiteBuilding(building) {
        if (!this.config.ui.enabled) return;
        this.io.emit('building_visited', building);
    }

    /**
     * Send the inventory to a client after it request it
     * @param {object} client - the socket client to send info to
     */
    async sendInventory(client) {
        const inventory = await this.player.getInventory();
        client.emit('inventory_list', inventory);
    }

    /**
     * Send our pokemon list to the client after it request it
     * @param {object} client - the socket client to send info to
     */
    async sendCreatures(client) {
        const creatures = await this.player.getCreatures();
        for (const creature of creatures) {
            creature.fullname = enums.CreatureType[creature.name];
            creature.evolutions = {};
            creature.possibleEvolutions.forEach((v, k) => { creature.evolutions[v] = k; });
        }
        const candies = {};
        this.state.player.avatar.candies.forEach((v, k) => { candies[k] = v; });
        client.emit('creature_list', {
            creatures,
            candies,
            dust: this.state.player.avatar.dust,
        });
    }

    /**
     * Send our egg list to a client after it request it
     * @param {object} client - the socket client to send info to
     */
    async sendEggs(client) {
        const hatchInfo = await this.player.getHatchingInfo();
        client.emit('eggs_list', {
            km_walked: this.state.player.totalDistanceF,
            egg_incubators: hatchInfo.incubators,
            eggs: hatchInfo.eggs,
            max: hatchInfo.max,
        });
    }

    /**
     * Send player stats to all clients
     */
    sendPlayerStats() {
        if (this.state.player && this.state.player.avatar) {
            this.io.emit('player_stats', { player: this.state.player.avatar });
        }
    }

    /**
     * Transfer a creature after the client request it
     * @param {object} client - the socket client to send info to if needed
     * @param {object} msg - message send from the ui
     */
    transferCreature(client, msg) {
        const todos: any[] = this.state.todo;
        const release = _.find(todos, todo => todo.call === 'release_creature');
        if (release) {
            release.creatures.push(msg.id);
        } else {
            this.state.todo.push({
                call: 'release_creature',
                creatures: [msg.id],
            });
        }
    }

    dropItems(client, msg) {
        this.state.todo.push({
            call: 'drop_items',
            id: msg.id,
            count: msg.count,
        });
    }

    evolveCreature(client, msg) {
        this.state.todo.push({
            call: 'evolve_creature',
            creature: msg.id,
            to: msg.to,
        });
    }

    setDestination(latlng): any {
        logger.info('Go to manual location', latlng);
        this.state.path.waypoints = [];
        this.state.walker.router = new GoThereRouter(this.config, this.state, latlng, this.state.walker.router);
    }
}
