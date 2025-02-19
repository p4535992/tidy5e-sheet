import { preloadTidy5eHandlebarsTemplates } from "./app/tidy5e-npc-templates.js";

import { tidy5eListeners } from "./app/listeners.js";
import { tidy5eContextMenu } from "./app/context-menu.js";
import { tidy5eShowActorArt } from "./app/show-actor-art.js";
import { tidy5eItemCard } from "./app/itemcard.js";
import { tidy5eAmmoSwitch } from "./app/ammo-switch.js";
import { applyLazyMoney } from "./app/lazymoney.js";
import { applyLazyExp, applyLazyHp } from "./app/lazyExpAndHp.js";
import { applyLocksNpcSheet } from "./app/lockers.js";
import { applyColorPickerCustomization } from "./app/color-picker.js";
import { addFavorites } from "./app/tidy5e-favorites.js";
import CONSTANTS from "./app/constants.js";
import { is_real_number } from "./app/helpers.js";

/**
 * An Actor sheet for NPC type characters in the D&D5E system.
 * Extends the base ActorSheet5e class.
 * @type {ActorSheet5eNPC}
 */

let npcScrollPos = 0;

/* handlebars helper function to check if strings are empty */
Handlebars.registerHelper("check", function (value, comparator) {
	return value === comparator ? "No content" : value;
});

export default class Tidy5eNPC extends dnd5e.applications.actor.ActorSheet5eNPC {
	/**
	 * Define default rendering options for the NPC sheet
	 * @return {Object}
	 */
	static get defaultOptions() {
		let defaultTab = game.settings.get(CONSTANTS.MODULE_ID, "defaultActionsTab") != "default" ? game.settings.get(CONSTANTS.MODULE_ID, "defaultActionsTab") : "attributes";
		if (!game.modules.get("character-actions-list-5e")?.active && game.settings.get(CONSTANTS.MODULE_ID, "defaultActionsTab") == "actions") {
			defaultTab = "attributes";
		}

		return mergeObject(super.defaultOptions, {
			classes: ["tidy5e", "sheet", "actor", "npc"],
			width: game.settings.get(CONSTANTS.MODULE_ID, "npsSheetWidth") ?? 740,
			height: 720,
			tabs: [
				{
					navSelector: ".tabs",
					contentSelector: ".sheet-body",
					initial: defaultTab,
				},
			],
		});
	}

	/* -------------------------------------------- */
	/*  Rendering                                   */
	/* -------------------------------------------- */

	/**
	 * Get the correct HTML template path to use for rendering this particular sheet
	 * @type {String}
	 */
	get template() {
		if (!game.user.isGM && this.actor.limited) return "modules/tidy5e-sheet/templates/actors/tidy5e-npc-ltd.html";
		return "modules/tidy5e-sheet/templates/actors/tidy5e-npc.html";
	}

	/* -------------------------------------------- */

	/**
	 * Organize Owned Items for rendering the NPC sheet
	 * @override
	 * @private
	 */
	_prepareItems(context) {
		// super._prepareItems(context);
		// =========================
		// Original system code
		// =========================

		// Categorize Items as Features and Spells
		const features = {
			weapons: {
				label: game.i18n.localize("DND5E.AttackPl"),
				items: [],
				hasActions: true,
				dataset: { type: "weapon", "weapon-type": "natural" },
			},
			actions: {
				label: game.i18n.localize("DND5E.ActionPl"),
				items: [],
				hasActions: true,
				dataset: { type: "feat", "activation.type": "action" },
			},
			passive: { label: game.i18n.localize("DND5E.Features"), items: [], dataset: { type: "feat" } },
			equipment: { label: game.i18n.localize("DND5E.Inventory"), items: [], dataset: { type: "loot" } },
		};

		// Start by classifying items into groups for rendering
		let [spells, other] = context.items.reduce(
			(arr, item) => {
				const { quantity, uses, recharge, target } = item.system;
				const ctx = (context.itemContext[item.id] ??= {});
				ctx.isStack = Number.isNumeric(quantity) && quantity !== 1;
				ctx.hasUses = uses && uses.max > 0;
				ctx.isOnCooldown = recharge && !!recharge.value && recharge.charged === false;
				ctx.isDepleted = item.isOnCooldown && uses.per && uses.value > 0;
				ctx.hasTarget = !!target && !["none", ""].includes(target.type);
				ctx.canToggle = false;
				if (item.type === "spell") arr[0].push(item);
				else arr[1].push(item);
				return arr;
			},
			[[], []]
		);

		// Apply item filters
		spells = this._filterItems(spells, this._filters.spellbook);
		other = this._filterItems(other, this._filters.features);

		// Organize Spellbook
		const spellbook = this._prepareSpellbook(context, spells);

		// Organize Features
		for (let item of other) {
			if (item.type === "weapon") features.weapons.items.push(item);
			else if (item.type === "feat") {
				if (item.system.activation.type) features.actions.items.push(item);
				else features.passive.items.push(item);
			} else features.equipment.items.push(item);
		}

		// Assign and return
		context.inventoryFilters = true;
		// context.features = Object.values(features); // Removed from 4535992
		context.spellbook = spellbook;
		// =========================
		// End original system code
		// =========================

		// Sort others equipements type
		const sortingOrder = {
			equipment: 1,
			consumable: 2,
		};

		features.equipment.items.sort((a, b) => {
			if (!a.hasOwnProperty("type") || !b.hasOwnProperty("type")) {
				return 0;
			}
			const first = a["type"].toLowerCase() in sortingOrder ? sortingOrder[a["type"]] : Number.MAX_SAFE_INTEGER;
			const second = b["type"].toLowerCase() in sortingOrder ? sortingOrder[b["type"]] : Number.MAX_SAFE_INTEGER;

			let result = 0;
			if (first < second) {
				result = -1;
			} else if (first > second) {
				result = 1;
			}
			return result;
		});

		context.features = Object.values(features);
	}

	/* -------------------------------------------- */

	/**
	 * A helper method to establish the displayed preparation state for an item
	 * @param {Item} item
	 * @private
	 */
	// TODO to remove with system 2.1.X
	_prepareItemToggleState(item) {
		if (item.type === "spell") {
			const isAlways = getProperty(item.system, "preparation.mode") === "always";
			const isPrepared = getProperty(item.system, "preparation.prepared");
			item.toggleClass = isPrepared ? "active" : "";
			if (isAlways) item.toggleClass = "fixed";
			if (isAlways) item.toggleTitle = CONFIG.DND5E.spellPreparationModes.always;
			else if (isPrepared) item.toggleTitle = CONFIG.DND5E.spellPreparationModes.prepared;
			else item.toggleTitle = game.i18n.localize("DND5E.SpellUnprepared");
		} else {
			const isActive = getProperty(item.system, "equipped");
			item.toggleClass = isActive ? "active" : "";
			item.toggleTitle = game.i18n.localize(isActive ? "DND5E.Equipped" : "DND5E.Unequipped");
		}
	}

	/* -------------------------------------------- */

	/**
	 * Add some extra data when rendering the sheet to reduce the amount of logic required within the template.
	 */
	async getData(options) {
		const context = await super.getData(options);

		Object.keys(context.abilities).forEach((id) => {
			context.abilities[id].abbr = CONFIG.DND5E.abilityAbbreviations[id];
		});

		// Journal HTML enrichment

		context.journalNotes1HTML = await TextEditor.enrichHTML(context.actor.flags[CONSTANTS.MODULE_ID]?.notes1?.value, {
			secrets: this.actor.isOwner,
			rollData: context.rollData,
			async: true,
			relativeTo: this.actor,
		});

		context.journalNotes2HTML = await TextEditor.enrichHTML(context.actor.flags[CONSTANTS.MODULE_ID]?.notes2?.value, {
			secrets: this.actor.isOwner,
			rollData: context.rollData,
			async: true,
			relativeTo: this.actor,
		});

		context.journalNotes3HTML = await TextEditor.enrichHTML(context.actor.flags[CONSTANTS.MODULE_ID]?.notes3?.value, {
			secrets: this.actor.isOwner,
			rollData: context.rollData,
			async: true,
			relativeTo: this.actor,
		});

		context.journalNotes4HTML = await TextEditor.enrichHTML(context.actor.flags[CONSTANTS.MODULE_ID]?.notes4?.value, {
			secrets: this.actor.isOwner,
			rollData: context.rollData,
			async: true,
			relativeTo: this.actor,
		});

		context.journalHTML = await TextEditor.enrichHTML(context.actor.flags[CONSTANTS.MODULE_ID]?.notes?.value, {
			secrets: this.actor.isOwner,
			rollData: context.rollData,
			async: true,
			relativeTo: this.actor,
		});

		context.appId = this.appId;
		context.allowCantripToBePreparedOnContext = game.settings.get(CONSTANTS.MODULE_ID, "allowCantripToBePreparedOnContext");
		context.hideSpellbookTabNpc = game.settings.get(CONSTANTS.MODULE_ID, "hideSpellbookTabNpc");
		context.isGM = game.user.isGM;
		context.allowHpMaxOverride = game.settings.get(CONSTANTS.MODULE_ID, "allowHpMaxOverride");
		context.rightClickDisabled = game.settings.get(CONSTANTS.MODULE_ID, "rightClickDisabled");
		context.classicControlsEnabled = game.settings.get(CONSTANTS.MODULE_ID, "classicControlsEnabled");
		context.classicControlsDisabled = !game.settings.get(CONSTANTS.MODULE_ID, "classicControlsEnabled");

		context.hpOverlayCalculationCurrent = 
		(   
			100 /
			(
				(is_real_number(this.actor.system?.attributes?.hp?.max) ? this.actor.system.attributes.hp.max : 1) 
				+ (is_real_number(this.actor.system?.attributes?.hp?.tempmax) ? this.actor.system.attributes.hp.tempmax : 0)
			)
		)
		* (is_real_number(this.actor.system?.attributes?.hp?.value) ? this.actor.system.attributes.hp.value : 0)
		+ (is_real_number(this.actor.system?.attributes?.hp?.temp) ? this.actor.system.attributes.hp.temp : 0);

		context.hpOverlayCalculationCurrent = context.hpOverlayCalculationCurrent  + "%"

		return context;
	}

	/* -------------------------------------------- */
	/*  Event Listeners and Handlers                */
	/* -------------------------------------------- */

	/**
	 * Activate event listeners using the prepared sheet HTML
	 * @param html {HTML}   The prepared HTML object ready to be rendered into the DOM
	 */
	activateListeners(html) {
		super.activateListeners(html);

		let actor = this.actor;

		tidy5eListeners(html, actor, this);
		tidy5eContextMenu(html, this);
		tidy5eShowActorArt(html, actor);
		if (game.settings.get(CONSTANTS.MODULE_ID, "itemCardsForNpcs")) {
			tidy5eItemCard(html, actor);
		}
		tidy5eAmmoSwitch(html, actor);

		// calculate average hp on right clicking roll hit dice icon
		html.find(".portrait-hp-formula span.rollable").mousedown(async (event) => {
			switch (event.which) {
				case 3: {
					let formula = actor.system.attributes.hp.formula;
					// console.log(formula);
					let r = new Roll(formula);
					let term = r.terms;
					// console.log(term);
					let averageString = "";
					for (let i = 0; i < term.length; i++) {
						let type = term[i].constructor.name;
						switch (type) {
							case "Die": {
								averageString += Math.floor((term[i].faces * term[i].number + term[i].number) / 2);
								break;
							}
							case "OperatorTerm": {
								averageString += term[i].operator;
								break;
							}
							case "NumericTerm": {
								averageString += term[i].number;
								break;
							}
							default: {
								break;
							}
						}
					}
					// console.log(averageString);

					let average = 0;
					averageString = averageString.replace(/\s/g, "").match(/[+\-]?([0-9\.\s]+)/g) || [];
					while (averageString.length) {
						average += parseFloat(averageString.shift());
					}
					// console.log(average);
					let data = {};
					data["system.attributes.hp.value"] = average;
					data["system.attributes.hp.max"] = average;
					actor.update(data);

					break;
				}
			}
		});

		html.find(".toggle-personality-info").click(async (event) => {
			if (actor.getFlag(CONSTANTS.MODULE_ID, "showNpcPersonalityInfo")) {
				await actor.unsetFlag(CONSTANTS.MODULE_ID, "showNpcPersonalityInfo");
			} else {
				await actor.setFlag(CONSTANTS.MODULE_ID, "showNpcPersonalityInfo", true);
			}
		});

		html.find(".rollable[data-action=rollInitiative]").click(function () {
			return actor.rollInitiative({ createCombatants: true });
		});

		// store Scroll Pos
		let attributesTab = html.find(".tab.attributes");
		attributesTab.scroll(function () {
			npcScrollPos = $(this).scrollTop();
		});
		let tabNav = html.find('a.item:not([data-tab="attributes"])');
		tabNav.click(function () {
			npcScrollPos = 0;
			attributesTab.scrollTop(npcScrollPos);
		});

		// Rollable Health Formula
		html.find(".health .rollable").click(this._onRollHealthFormula.bind(this));

		// toggle proficient skill visibility in the skill list
		html.find(".skills-list .toggle-proficient").click(async (event) => {
			if (actor.getFlag(CONSTANTS.MODULE_ID, "npcSkillsExpanded")) {
				await actor.unsetFlag(CONSTANTS.MODULE_ID, "npcSkillsExpanded");
			} else {
				await actor.setFlag(CONSTANTS.MODULE_ID, "npcSkillsExpanded", true);
			}
		});

		// toggle empty traits visibility in the traits list
		html.find(".traits .toggle-traits").click(async (event) => {
			if (actor.getFlag(CONSTANTS.MODULE_ID, "traitsExpanded")) {
				await actor.unsetFlag(CONSTANTS.MODULE_ID, "traitsExpanded");
			} else {
				await actor.setFlag(CONSTANTS.MODULE_ID, "traitsExpanded", true);
			}
		});

		// changing item qty and charges values (removing if both value and max are 0)
		html.find(".item:not(.items-header) input").change((event) => {
			let value = event.target.value;
			let itemId = $(event.target).parents(".item")[0].dataset.itemId;
			let path = event.target.dataset.path;
			let data = {};
			data[path] = Number(event.target.value);
			actor.items.get(itemId).update(data);
		});

		// creating charges for the item
		html.find(".inventory-list .item .addCharges").click((event) => {
			let itemId = $(event.target).parents(".item")[0].dataset.itemId;
			let item = actor.items.get(itemId);

			item.system.uses = { value: 1, max: 1 };
			let data = {};
			data["system.uses.value"] = 1;
			data["system.uses.max"] = 1;

			actor.items.get(itemId).update(data);
		});

		// Short and Long Rest
		html.find(".short-rest").click(this._onShortRest.bind(this));
		html.find(".long-rest").click(this._onLongRest.bind(this));
	}

	/* -------------------------------------------- */

	/**
	 * Handle duplicate an existing Item entry from the Advancement.
	 * @param {Event} event        The originating click event.
	 * @returns {Promise<Item5e>}  The updated parent Item after the application re-renders.
	 * @protected
	 */
	async _onItemDuplicate(event) {
		event.preventDefault();
		// const uuidToDuplicate = event.currentTarget.closest("[data-item-uuid]")?.dataset.itemUuid;
		const uuidToDuplicate = event.currentTarget.closest("[data-item-id]")?.dataset.itemId;
		if (!uuidToDuplicate) return;
		const item = this.actor.items.get(uuidToDuplicate);
		item.clone({ name: game.i18n.format("DOCUMENT.CopyOf", { name: item.name }) }, { save: true });
	}

	/* -------------------------------------------- */

	/**
	 * Handle rolling NPC health values using the provided formula
	 * @param {Event} event     The original click event
	 * @private
	 */
	async _onRollHealthFormula(event) {
		event.preventDefault();
		const formula = this.actor.system.attributes.hp.formula;
		if (!formula) return;
		// const hp = new Roll(formula).roll().total;
		const roll_hp = await new Roll(formula).roll();
		const hp = roll_hp.total;
		AudioHelper.play({ src: CONFIG.sounds.dice });
		this.actor.update({
			"system.attributes.hp.value": hp,
			"system.attributes.hp.max": hp,
		});
	}

	/* -------------------------------------------- */

	/**
	 * Take a short rest, calling the relevant function on the Actor instance
	 * @param {Event} event   The triggering click event
	 * @private
	 */
	async _onShortRest(event) {
		event.preventDefault();
		await this._onSubmit(event);
		if (game.settings.get(CONSTANTS.MODULE_ID, "restingForNpcsChatDisabled")) {
			let obj = {
				dialog: true,
				chat: false,
			};
			return this.actor.longRest(obj);
		}
		return this.actor.longRest();
	}

	/* -------------------------------------------- */

	/**
	 * Take a long rest, calling the relevant function on the Actor instance
	 * @param {Event} event   The triggering click event
	 * @private
	 */
	async _onLongRest(event) {
		event.preventDefault();
		await this._onSubmit(event);
		if (game.settings.get(CONSTANTS.MODULE_ID, "restingForNpcsChatDisabled")) {
			let obj = {
				dialog: true,
				chat: false,
			};
			return this.actor.longRest(obj);
		}
		return this.actor.longRest();
	}

	// add actions module
	async _renderInner(...args) {
		const html = await super._renderInner(...args);
		const actionsListApi = game.modules.get("character-actions-list-5e")?.api;
		let injectNPCSheet;
		if (game.modules.get("character-actions-list-5e")?.active) injectNPCSheet = game.settings.get("character-actions-list-5e", "inject-npcs");

		try {
			if (game.modules.get("character-actions-list-5e")?.active && injectNPCSheet) {
				// Update the nav menu
				const actionsTabButton = $('<a class="item" data-tab="actions">' + game.i18n.localize(`DND5E.ActionPl`) + "</a>");
				const tabs = html.find('.tabs[data-group="primary"]');
				tabs.prepend(actionsTabButton);

				// Create the tab
				const sheetBody = html.find(".sheet-body");
				const actionsTab = $(`<div class="tab actions" data-group="primary" data-tab="actions"></div>`);
				const actionsLayout = $(`<div class="list-layout"></div>`);
				actionsTab.append(actionsLayout);
				sheetBody.prepend(actionsTab);

				// const actionsTab = html.find('.actions-target');

				const actionsTabHtml = $(await actionsListApi.renderActionsList(this.actor));
				actionsLayout.html(actionsTabHtml);
			}
		} catch (e) {
			// log(true, e);
		}

		return html;
	}
}

// restore scroll position
async function restoreScrollPosition(app, html, data) {
	html.find(".tab.attributes").scrollTop(npcScrollPos);
	// $('.tab.attributes').scrollTop(npcScrollPos);
}

// handle skills list display
async function toggleSkillList(app, html, data) {
	html.find(".skills-list:not(.always-visible):not(.expanded) .skill:not(.proficient)").remove();
}

// handle traits list display
async function toggleTraitsList(app, html, data) {
	html.find(".traits:not(.always-visible):not(.expanded) .form-group.inactive").remove();
}

// toggle item icon
async function toggleItemMode(app, html, data) {
	html.find(".item-toggle").click((ev) => {
		ev.preventDefault();
		let itemId = ev.currentTarget.closest(".item").dataset.itemId;
		let item = app.actor.items.get(itemId);
		console.log(item.type);
		let attr = item.type === "spell" ? "system.preparation.prepared" : "system.equipped";
		if (item.type !== "feat") {
			return item.update({ [attr]: !foundry.utils.getProperty(item, attr) });
		}
	});
}

// restore scroll position
async function resetTempHp(app, html, data) {
	let actor = app.actor;
	if (data.editable && !actor.compendium) {
		let temp = actor.system.attributes.hp.temp,
			tempmax = actor.system.attributes.hp.tempmax;

		if (temp == 0) {
			actor.update({ "system.attributes.hp.temp": null });
		}
		if (tempmax == 0) {
			actor.update({ "system.attributes.hp.tempmax": null });
		}
	}
}

// Set Sheet Classes
async function setSheetClasses(app, html, data) {
	const { token } = app;
	const actor = app.actor;
	if (actor.getFlag(CONSTANTS.MODULE_ID, "showNpcPersonalityInfo")) {
		html.find(".tidy5e-sheet.tidy5e-npc .left-notes").removeClass("hidden");
	}
	if (game.settings.get(CONSTANTS.MODULE_ID, "rightClickDisabled")) {
		if (game.settings.get(CONSTANTS.MODULE_ID, "classicControlsEnabled")) {
			html.find(".tidy5e-sheet.tidy5e-npc .grid-layout .items-list").addClass("alt-context");
		} else {
			html.find(".tidy5e-sheet.tidy5e-npc .items-list").addClass("alt-context");
		}
	}
	// if (game.settings.get(CONSTANTS.MODULE_ID, "classicControlsEnabled")) {
	//   tidy5eClassicControls(html);
	// }
	if (!game.settings.get(CONSTANTS.MODULE_ID, "classicControlsEnabled")) {
		html.find(".tidy5e-sheet.tidy5e-npc .items-header-controls").remove();
	}
	if (game.settings.get(CONSTANTS.MODULE_ID, "traitsMovedBelowResourceNpc")) {
		let altPos = html.find(".alt-trait-pos");
		let traits = html.find(".traits");
		altPos.append(traits);
	}
	if (!game.settings.get(CONSTANTS.MODULE_ID, "restingForNpcsEnabled")) {
		html.find(".tidy5e-sheet.tidy5e-npc .rest-container").remove();
	}
	if (game.settings.get(CONSTANTS.MODULE_ID, "portraitStyle") == "npc" || game.settings.get(CONSTANTS.MODULE_ID, "portraitStyle") == "all") {
		html.find(".tidy5e-sheet.tidy5e-npc .profile").addClass("roundPortrait");
	}
	if (game.settings.get(CONSTANTS.MODULE_ID, "hpOverlayDisabledNpc")) {
		html.find(".tidy5e-sheet.tidy5e-npc .profile").addClass("disable-hp-overlay");
	}
	if (game.settings.get(CONSTANTS.MODULE_ID, "hpBarDisabled")) {
		html.find(".tidy5e-sheet.tidy5e-npc .profile").addClass("disable-hp-bar");
	}
	if (game.settings.get(CONSTANTS.MODULE_ID, "hpOverlayBorderNpc") > 0) {
		$(".system-dnd5e")
			.get(0)
			.style.setProperty("--npc-border", game.settings.get(CONSTANTS.MODULE_ID, "hpOverlayBorderNpc") + "px");
	} else {
		$(".system-dnd5e").get(0).style.removeProperty("--npc-border");
	}
	if (game.settings.get(CONSTANTS.MODULE_ID, "traitsAlwaysShownNpc")) {
		html.find(".tidy5e-sheet.tidy5e-npc .traits").addClass("always-visible");
	}
	if (game.settings.get(CONSTANTS.MODULE_ID, "traitLabelsEnabled")) {
		html.find(".tidy5e-sheet.tidy5e-npc .traits").addClass("show-labels");
	}
	if (game.settings.get(CONSTANTS.MODULE_ID, "skillsAlwaysShownNpc")) {
		html.find(".tidy5e-sheet.tidy5e-npc .skills-list").addClass("always-visible");
	}
	if (token && token.actor.prototypeToken.actorLink && game.settings.get(CONSTANTS.MODULE_ID, "linkMarkerNpc") == "both") {
		html.find(".tidy5e-sheet.tidy5e-npc").addClass("linked");
	}
	if (token && !token.actor.prototypeToken.actorLink && (game.settings.get(CONSTANTS.MODULE_ID, "linkMarkerNpc") == "unlinked" || game.settings.get(CONSTANTS.MODULE_ID, "linkMarkerNpc") == "both")) {
		html.find(".tidy5e-sheet.tidy5e-npc").addClass("unlinked");
	}
	if (!token && (game.settings.get(CONSTANTS.MODULE_ID, "linkMarkerNpc") == "unlinked" || game.settings.get(CONSTANTS.MODULE_ID, "linkMarkerNpc") == "both")) {
		html.find(".tidy5e-sheet.tidy5e-npc").addClass("original");
	}

	$(".info-card-hint .key").html(game.settings.get(CONSTANTS.MODULE_ID, "itemCardsFixKey"));

	applyColorPickerCustomization(html);
}

// Abbreviate Currency
async function abbreviateCurrency(app, html, data) {
	html.find(".currency .currency-item label").each(function () {
		let currency = $(this).data("denom").toUpperCase();
		// let abbr = CONFIG.DND5E.currencies[currency].abbreviation;
		// if(abbr == CONFIG.DND5E.currencies[currency].abbreviation){
		// 	abbr = currency;
		// }
		let abbr = game.i18n.localize(`DND5E.CurrencyAbbr${currency}`);
		if (abbr == `DND5E.CurrencyAbbr${currency}`) {
			abbr = currency;
		}
		$(this).html(abbr);
	});
}

// Hide empty Spellbook
async function hideSpellbook(app, html, data) {
	let spellbook = html.find(".spellbook-footer");

	if (spellbook.hasClass("spellbook-empty")) {
		html.find(".spellbook-title").addClass("toggle-spellbook");
		// html.find('.spellbook-title .fa-caret-down').show();
		// html.find('.spellbook-title .fa-caret-up').hide();
		html.find(".spellbook-title + .list-layout").hide();
		html.find(".spellcasting-ability").hide();

		$(".toggle-spellbook").on("click", function () {
			html.find(".spellbook-title").toggleClass("show");
			// html.find('.spellbook-title .fa-caret-down').toggle();
			// html.find('.spellbook-title .fa-caret-up').toggle();
			html.find(".spellbook-title + .list-layout").toggle();
			html.find(".spellcasting-ability").toggle();
		});
	}
}

// Edit Protection - Hide empty Inventory Sections, add and delete-buttons
async function editProtection(app, html, data) {
	let actor = app.actor;
	if (!actor.getFlag(CONSTANTS.MODULE_ID, "allow-edit")) {
		/* MOVED TO LOCKERS.JS
    if (game.settings.get(CONSTANTS.MODULE_ID, "editTotalLockEnabled")) {
      html.find(".skill input").prop("disabled", true);
      html.find(".skill .config-button").remove();
      html.find(".skill .proficiency-toggle").remove();
      html.find(".ability-score").prop("disabled", true);
      html.find(".ac-display input").prop("disabled", true);
      html.find(".initiative input").prop("disabled", true);
      html.find(".hp-max").prop("disabled", true);
      html.find(".resource-name input").prop("disabled", true);
      html.find(".res-max").prop("disabled", true);
      html.find(".res-options").remove();
      html.find(".ability-modifiers .proficiency-toggle").remove();
      html.find(".ability .config-button").remove();
      html
        .find(
          ".traits .config-button,.traits .trait-selector,.traits .proficiency-selector"
        )
        .remove();
      html.find("[contenteditable]").prop("contenteditable", false);
      html.find(".caster-level input").prop("disabled", true);
      html.find(".spellcasting-attribute select").prop("disabled", true);
    }
    */

		let itemContainer = html.find(".inventory-list:not(.spellbook-list).items-list");
		html.find(".inventory-list:not(.spellbook-list) .items-header").each(function () {
			if ($(this).next(".item-list").find("li").length - $(this).next(".item-list").find("li.items-footer").length == 0) {
				$(this).next(".item-list").addClass("hidden").hide();
				$(this).addClass("hidden").hide();
			}
		});

		html.find(".inventory-list .items-footer").addClass("hidden").hide();
		html.find(".inventory-list .item-control.item-delete").remove();
		html.find(".inventory-list .item-control.item-duplicate").remove();
		html.find(".effects .effect-control.effect-delete").remove();
		html.find(".effects .effect-control.effect-duplicate").remove();

		let actor = app.actor,
			legAct = actor.system.resources.legact.max,
			legRes = actor.system.resources.legres.max,
			lair = actor.system.resources.lair.value;

		if (!lair && legAct < 1 && legRes < 1) {
			html.find(".counters").addClass("hidden").hide();
		}

		if (itemContainer.children().length < 1) {
			itemContainer.append(`<span class="notice">This section is empty. Unlock the sheet to edit.</span>`);
		}
	}
}

// add fav button for npc-favorites
async function npcFavorites(app, html, data) {
	// TODO intgrate favorite mechanism for NPC too ?
	// Issue https://github.com/sdenec/tidy5e-sheet/issues/539
	// for now is beeter use other external module
	// addFavorites(app, html, data);
}

// Add Spell Slot Marker
function spellSlotMarker(app, html, data) {
	if (game.settings.get(CONSTANTS.MODULE_ID, "hideSpellSlotMarker")) {
		return;
	}
	let actor = app.actor;
	let items = data.actor.items;
	let options = ["pact", "spell1", "spell2", "spell3", "spell4", "spell5", "spell6", "spell7", "spell8", "spell9"];
	for (let o of options) {
		let max = html.find(`.spell-max[data-level=${o}]`);
		let name = max.closest(".spell-slots");
		let spellData = actor.system.spells[o];
		if (spellData.max === 0) {
			continue;
		}
		let contents = ``;
		for (let i = 1; i <= spellData.max; i++) {
			if (i <= spellData.value) {
				contents += `<span class="dot"></span>`;
			} else {
				contents += `<span class="dot empty"></span>`;
			}
		}
		name.before(`<div class="spellSlotMarker">${contents}</div>`);
	}

	html.find(".spellSlotMarker .dot").mouseenter((ev) => {
		const parentEl = ev.currentTarget.parentElement;
		const index = [...parentEl.children].indexOf(ev.currentTarget);
		const dots = parentEl.querySelectorAll(".dot");

		if (ev.currentTarget.classList.contains("empty")) {
			for (let i = 0; i < dots.length; i++) {
				if (i <= index) {
					dots[i].classList.contains("empty") ? dots[i].classList.add("change") : "";
				}
			}
		} else {
			for (let i = 0; i < dots.length; i++) {
				if (i >= index) {
					dots[i].classList.contains("empty") ? "" : dots[i].classList.add("change");
				}
			}
		}
	});

	html.find(".spellSlotMarker .dot").mouseleave((ev) => {
		const parentEl = ev.currentTarget.parentElement;
		$(parentEl).find(".dot").removeClass("change");
	});

	html.find(".spellSlotMarker .dot").click(async (ev) => {
		const index = [...ev.currentTarget.parentElement.children].indexOf(ev.currentTarget);
		const slots = $(ev.currentTarget).parents(".spell-level-slots");
		const spellLevel = slots.find(".spell-max").data("level");
		console.log(spellLevel, index);
		if (spellLevel) {
			let path = `data.spells.${spellLevel}.value`;
			if (ev.currentTarget.classList.contains("empty")) {
				await actor.update({
					[path]: index + 1,
				});
			} else {
				await actor.update({
					[path]: index,
				});
			}
		}
	});
}

// Hide Standard Encumbrance Bar
function hideStandardEncumbranceBar(app, html, data) {
	if (!game.settings.get(CONSTANTS.MODULE_ID, "hideStandardEncumbranceBar")) {
		return;
	}
	const elements = html.find(".encumbrance");
	if (elements && elements.length > 0) {
		for (const elem of elements) {
			elem.style.display = "none";
		}
	}
}

Actors.registerSheet("dnd5e", Tidy5eNPC, {
	types: ["npc"],
	makeDefault: true,
});

Hooks.once("init", () => {
	preloadTidy5eHandlebarsTemplates();
});

Hooks.once("ready", () => {
	// can be removed when 0.7.x is stable
	// if (window.BetterRolls) {
	//   window.BetterRolls.hooks.addActorSheet("Tidy5eNPC");
	// }
});

Hooks.on("renderTidy5eNPC", (app, html, data) => {
	setSheetClasses(app, html, data);
	toggleSkillList(app, html, data);
	toggleTraitsList(app, html, data);
	toggleItemMode(app, html, data);
	restoreScrollPosition(app, html, data);
	abbreviateCurrency(app, html, data);
	hideSpellbook(app, html, data);
	resetTempHp(app, html, data);
	editProtection(app, html, data);
	npcFavorites(app, html, data);
	spellSlotMarker(app, html, data);
	hideStandardEncumbranceBar(app, html, data);
	applyLazyMoney(app, html, data);
	applyLazyExp(app, html, data);
	applyLazyHp(app, html, data);
	// console.log(data.actor);

	// NOTE LOCKS ARE THE LAST THING TO SET
	applyLocksNpcSheet(app, html, data);
});

/** perform some necessary operations on character sheet **/
Hooks.on("renderActorSheet", (app, html, data) => {
	// Temporary Patch for module incompatibility with https://github.com/misthero/dnd5e-custom-skills
	// Issue https://github.com/sdenec/tidy5e-sheet/issues/662
	if(game.modules.get("dnd5e-custom-skills")?.active) {
		html.find(".tidy5e-sheet.tidy5e-npc .ability-scores.custom-abilities").removeClass("custom-abilities");
	}
});