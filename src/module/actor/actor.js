import { DiceSFRPG, RollContext } from "../dice.js";
import { ShortRestDialog } from "../apps/short-rest.js";
import { SpellCastDialog } from "../apps/spell-cast-dialog.js";
import { AddEditSkillDialog } from "../apps/edit-skill-dialog.js";
import { NpcSkillToggleDialog } from "../apps/npc-skill-toggle-dialog.js";
import { SFRPGModifierType, SFRPGModifierTypes, SFRPGEffectType } from "../modifiers/types.js";
import SFRPGModifier from "../modifiers/modifier.js";
import SFRPGModifierApplication from "../apps/modifier-app.js";
import { DroneRepairDialog } from "../apps/drone-repair-dialog.js";
import { getItemContainer } from "./actor-inventory.js"

import { } from "./starship-update.js"

/**
 * Extend the base :class:`Actor` to implement additional logic specialized for SFRPG
 */
export class ActorSFRPG extends Actor {

    /** @override */
    getRollData() {
        const data = super.getRollData();
        let casterLevel = 0;
        data.classes = this.data.items.reduce((obj, i) => {
            const keyAbilityScore = i.data.kas || "str";
            if (i.type === "class") {
                const classData = {
                    keyAbilityMod: this.data.data.abilities[keyAbilityScore].mod,
                    levels: i.data.levels,
                    keyAbilityScore: keyAbilityScore,
                    skillRanksPerLevel: i.data.skillRanks.value
                };

                if (i.data.isCaster) {
                    casterLevel += i.data.levels
                }

                obj[i.name.slugify({replacement: "_", strict: true})] = classData;
            }
            return obj;
        }, {});

        data.cl = casterLevel;

        return data;
    }

    /**
     * Augment the basic actor data with additional dynamic data.
     * 
     * @param {Object} actorData The data for the actor
     * @returns {Object} The actors data
     */
    prepareData() {
        super.prepareData();
        const actorData = this.data;
        const data = actorData.data;
        const flags = actorData.flags;
        const actorType = actorData.type;

        this._ensureHasModifiers(data);
        const modifiers = this.getAllModifiers();

        const actorId = this._id;
        const items = actorData.items;
        const armor = items.find(item => item.type === "equipment" && item.data.equipped);
        const weapons = items.filter(item => item.type === "weapon" && item.data.equipped);
        const races = items.filter(item => item.type === "race");
        const frames = items.filter(item => item.type === "starshipFrame");
        const classes = items.filter(item => item.type === "class");
        const chassis = items.filter(item => item.type === "chassis");
        const theme = items.find(item => item.type === "theme");
        const mods = items.filter(item => item.type === "mod");
        const armorUpgrades = items.filter(item => item.type === "upgrade");
        const asis = items.filter(item => item.type === "asi");
        game.sfrpg.engine.process("process-actors", {
            actorId,
            type: actorType,
            data,
            flags,
            items,
            armor,
            weapons,
            races,
            classes,
            chassis,
            modifiers,
            theme,
            mods,
            armorUpgrades,
            asis,
            frames
        });
    }

    /**
     * TODO: Use these two methods to properly setup actor data for use
     * in the new Active Effects API.
     */
    prepareBaseData() { super.prepareBaseData(); }
    prepareDerivedData() { super.prepareDerivedData(); }

    /**
     * Check to ensure that this actor has a modifiers data object set, if not then set it. 
     * These will always be needed from hence forth, so we'll just make sure that they always exist.
     * 
     * @param {Object}      data The actor data to check against.
     * @param {String|Null} prop A specific property name to check.
     * 
     * @returns {Object}         The modified data object with the modifiers data object added.
     */
    _ensureHasModifiers(data, prop = null) {
        if (!hasProperty(data, "modifiers")) {
            console.log(`SFRPG | ${this.name} does not have the modifiers data object, attempting to create them...`);
            data.modifiers = [];
        }

        return data;
    }
    
    /**
     * Extend the default update method to enhance data before submission.
     * See the parent Entity.update method for full details.
     *
     * @param {Object} data     The data with which to update the Actor
     * @param {Object} options  Additional options which customize the update workflow
     * @return {Promise}        A Promise which resolves to the updated Entity
     */
    async update(data, options = {}) {
        const newSize = data['data.traits.size'];
        if (newSize && (newSize !== getProperty(this.data, "data.traits.size"))) {
            let size = CONFIG.SFRPG.tokenSizes[data['data.traits.size']];
            if (this.isToken) this.token.update({ height: size, width: size });
            else if (!data["token.width"] && !hasProperty(data, "token.width")) {
                setProperty(data, 'token.height', size);
                setProperty(data, 'token.width', size);
            }
        }

        return super.update(data, options);
    }

    /**
     * Extend OwnedItem creation logic for the SFRPG system to make weapons proficient by default when dropped on a NPC sheet
     * See the base Actor class for API documentation of this method
     * 
     * @param {String} embeddedName The type of Entity being embedded.
     * @param {Object} itemData The data object of the item
     * @param {Object} options Any options passed in
     * @returns {Promise}
     */
    async createEmbeddedEntity(embeddedName, itemData, options) {
        if (!this.hasPlayerOwner) {
            let t = itemData.type;
            let initial = {};           
            if (t === "weapon") initial['data.proficient'] = true;
            if (["weapon", "equipment"].includes(t)) initial['data.equipped'] = true;
            if (t === "spell") initial['data.prepared'] = true;
            mergeObject(itemData, initial);
        }

        return super.createEmbeddedEntity(embeddedName, itemData, options);
    }

    async useSpell(item, { configureDialog = true } = {}) {
        if (item.data.type !== "spell") throw new Error("Wrong item type");

        let lvl = item.data.data.level;
        const usesSlots = (lvl > 0) && item.data.data.preparation.mode === "";
        if (!usesSlots) return item.roll();

        let consume = true;
        if (configureDialog) {
            const spellFormData = await SpellCastDialog.create(this, item);
            lvl = parseInt(spellFormData.get("level"));
            consume = Boolean(spellFormData.get("consume"));
            if (lvl !== item.data.data.level) {
                item = item.constructor.createOwned(mergeObject(item.data, { "data.level": lvl }, { inplace: false }), this);
            }
        }

        if (consume && (lvl > 0)) {
            await this.update({
                [`data.spells.spell${lvl}.value`]: Math.max(parseInt(this.data.data.spells[`spell${lvl}`].value) - 1, 0)
            });
        }

        return item.roll();
    }

    /**
     * Edit a skill's fields
     * @param {string} skillId The skill id (e.g. "ins")
     * @param {Object} options Options which configure how the skill is edited
     */
    async editSkill(skillId, options = {}) {
        // Keeping this here for later
        // this.update({"data.skills.-=skillId": null});
        // use this to delete any unwanted skills.

        const skill = duplicate(this.data.data.skills[skillId]);
        const isNpc = this.data.type === "npc";
        const formData = await AddEditSkillDialog.create(skillId, skill, true, isNpc, this.owner),
            isTrainedOnly = Boolean(formData.get('isTrainedOnly')),
            hasArmorCheckPenalty = Boolean(formData.get('hasArmorCheckPenalty')),
            value = Boolean(formData.get('value')) ? 3 : 0,
            misc = Number(formData.get('misc')),
            ranks = Number(formData.get('ranks')),
            ability = formData.get('ability'),
            remove = Boolean(formData.get('remove'));

        if (remove) return this.update({ [`data.skills.-=${skillId}`]: null });

        let updateObject = {
            [`data.skills.${skillId}.ability`]: ability,
            [`data.skills.${skillId}.ranks`]: ranks,
            [`data.skills.${skillId}.value`]: value,
            [`data.skills.${skillId}.misc`]: misc,
            [`data.skills.${skillId}.isTrainedOnly`]: isTrainedOnly,
            [`data.skills.${skillId}.hasArmorCheckPenalty`]: hasArmorCheckPenalty
        };

        if (isNpc) updateObject[`data.skills.${skillId}.enabled`] = Boolean(formData.get('enabled'));

        if ("subname" in skill) {
            updateObject[`data.skills.${skillId}.subname`] = formData.get('subname');
        }

        return this.update(updateObject);
    }
    
    /**
     * Add a modifier to this actor.
     * 
     * @param {Object}        data               The data needed to create the modifier
     * @param {String}        data.name          The name of this modifier. Used to identify the modfier.
     * @param {Number|String} data.modifier      The modifier value.
     * @param {String}        data.type          The modifiers type. Used to determine stacking.
     * @param {String}        data.modifierType  Used to determine if this modifier is a constant value (+2) or a Roll formula (1d4).
     * @param {String}        data.effectType    The category of things that might be effected by this modifier.
     * @param {String}        data.subtab        What subtab should this modifier show under on the character sheet.
     * @param {String}        data.valueAffected The specific value being modified.
     * @param {Boolean}       data.enabled       Is this modifier activated or not.
     * @param {String}        data.source        Where did this modifier come from? An item, ability or something else?
     * @param {String}        data.notes         Any notes or comments about the modifier.
     * @param {String}        data.condition     The condition, if any, that this modifier is associated with.
     * @param {String|null}   data.id            Override the randomly generated id with this.
     */
    async addModifier({
        name = "", 
        modifier = 0, 
        type = SFRPGModifierTypes.UNTYPED, 
        modifierType = SFRPGModifierType.CONSTANT, 
        effectType = SFRPGEffectType.SKILL,
        subtab = "misc",
        valueAffected = "", 
        enabled = true, 
        source = "", 
        notes = "",
        condition = "",
        id = null
    } = {}) {
        const data = this._ensureHasModifiers(duplicate(this.data.data));
        const modifiers = data.modifiers;

        modifiers.push(new SFRPGModifier({
            name,
            modifier,
            type,
            modifierType,
            effectType,
            valueAffected,
            enabled,
            source,
            notes,
            subtab,
            condition,
            id
        }));

        await this.update({["data.modifiers"]: modifiers});
    }

    /**
     * Delete a modifier for this Actor.
     * 
     * @param {String} id The id for the modifier to delete
     */
    async deleteModifier(id) {
        const modifiers = this.data.data.modifiers.filter(mod => mod._id !== id);
        
        await this.update({"data.modifiers": modifiers});
    }

    /**
     * Edit a modifier for an Actor.
     * 
     * @param {String} id The id for the modifier to edit
     */
    editModifier(id) {
        const modifiers = duplicate(this.data.data.modifiers);
        const modifier = modifiers.find(mod => mod._id === id);

        new SFRPGModifierApplication(modifier, this).render(true);
    }

    /**
     * Returns an array of all modifiers on this actor. This will include items such as equipment, feat, classes, race, theme, etc.
     * 
     * @param {Boolean} ignoreTemporary Should we ignore temporary modifiers? Defaults to false.
     * @param {Boolean} ignoreEquipment Should we ignore equipment modifiers? Defaults to false.
     */
    getAllModifiers(ignoreTemporary = false, ignoreEquipment = false) {
        let allModifiers = this.data.data.modifiers.filter(mod => {
            return (!ignoreTemporary || mod.subtab === "permanent");
        });

        for (const actorModifier of allModifiers) {
            actorModifier.container = {actorId: this._id, itemId: null};
        }

        for (let item of this.data.items) {
            let modifiersToConcat = [];
            switch (item.type) {
                default:
                    if (item.data.equipped !== false) {
                        modifiersToConcat = item.data.modifiers;
                    }
                    break;
                case "upgrade":
                    {
                        if (!ignoreEquipment) {
                            const container = getItemContainer(this.data.items, item._id);
                            if (container && container.type === "equipment" && container.data.equipped) {
                                modifiersToConcat = item.data.modifiers;
                            }
                        }
                        break;
                    }
                case "fusion":
                case "weaponAccessory":
                    {
                        if (!ignoreEquipment) {
                            const container = getItemContainer(this.data.items, item._id);
                            if (container && container.type === "weapon" && container.data.equipped) {
                                modifiersToConcat = item.data.modifiers;
                            }
                        }
                        break;
                    }
                case "augmentation":
                    modifiersToConcat = item.data.modifiers;
                    break;
                case "feat":
                    if (item.data.activation?.type === "" || item.data.isActive) {
                        modifiersToConcat = item.data.modifiers;
                    }
                    break;
                case "equipment":
                case "shield":
                case "weapon":
                    if (!ignoreEquipment && item.data.equipped) {
                        modifiersToConcat = item.data.modifiers;
                    }
                    break;
            }

            if (modifiersToConcat && modifiersToConcat.length > 0) {
                for (const itemModifier of modifiersToConcat) {
                    itemModifier.container = {actorId: this._id, itemId: item._id};
                }

                allModifiers = allModifiers.concat(modifiersToConcat);
            }
        }
        return allModifiers;
    }

    /**
     * Toggles what NPC skills are shown on the sheet.
     */
    async toggleNpcSkills() {
        const skills = duplicate(this.data.data.skills);
        const formData = await NpcSkillToggleDialog.create(skills);
        let enabledSkills = {};
        const delta = Object.entries(skills).reduce((obj, curr) => {
            if (curr[1].enabled) obj[`data.skills.${curr[0]}.enabled`] = !curr[1].enabled;
            return obj;
        }, {});

        for (let [key, value] of formData.entries()) {
            enabledSkills[`data.${key}`] = Boolean(value);
        }
        
        enabledSkills = mergeObject(enabledSkills, delta, {overwrite: false, inplace: false});

        return await this.update(enabledSkills);
    }

    /**
     * Add a new skill
     * @param {Object} options Options which configure how the skill is added
     */
    async addSkill(options = {}) {
        const skill = {
            ability: "int",
            ranks: 0,
            value: 0,
            misc: 0,
            isTrainedOnly: false,
            hasArmorCheckPenalty: false,
            subname: ""
        };

        let skillId = "pro";
        let counter = 0;

        while (this.data.data.skills[skillId]) {
            skillId = `pro${++counter}`;
        }

        const formData = await AddEditSkillDialog.create(skillId, skill, false, this.hasPlayerOwner, this.owner),
            isTrainedOnly = Boolean(formData.get('isTrainedOnly')),
            hasArmorCheckPenalty = Boolean(formData.get('hasArmorCheckPenalty')),
            value = Boolean(formData.get('value')) ? 3 : 0,
            misc = Number(formData.get('misc')),
            ranks = Number(formData.get('ranks')),
            ability = formData.get('ability'),
            subname = formData.get('subname');

        let newSkillData = {
            [`data.skills.${skillId}`]: {},
            [`data.skills.${skillId}.isTrainedOnly`]: isTrainedOnly,
            [`data.skills.${skillId}.hasArmorCheckPenalty`]: hasArmorCheckPenalty,
            [`data.skills.${skillId}.value`]: value,
            [`data.skills.${skillId}.misc`]: misc,
            [`data.skills.${skillId}.ranks`]: ranks,
            [`data.skills.${skillId}.ability`]: ability,
            [`data.skills.${skillId}.subname`]: subname,
            [`data.skills.${skillId}.mod`]: value + misc + ranks,
            [`data.skills.${skillId}.enabled`]: true
        };

        return this.update(newSkillData);
    }

    /**
     * Roll a Skill Check
     * Prompt the user for input regarding Advantage/Disadvantage and any Situational Bonus
     * @param {string} skillId      The skill id (e.g. "ins")
     * @param {Object} options      Options which configure how the skill check is rolled
     */
    async rollSkill(skillId, options = {}) {
        const skl = this.data.data.skills[skillId];

        if (!this.hasPlayerOwner) {
            return await this.rollSkillCheck(skillId, skl, options);
        }

        if (skl.isTrainedOnly && !(skl.ranks > 0)) {
            let content = `${CONFIG.SFRPG.skills[skillId.substring(0, 3)]} is a trained only skill, but ${this.name} is not trained in that skill.
                Would you like to roll anyway?`;

            return new Promise(resolve => {
                new Dialog({
                    title: `${CONFIG.SFRPG.skills[skillId.substring(0, 3)]} is trained only`,
                    content: content,
                    buttons: {
                        yes: {
                            label: "Yes",
                            callback: () => resolve(this.rollSkillCheck(skillId, skl, options))
                        },
                        cancel: {
                            label: "No"
                        }
                    },
                    default: "cancel"
                }).render(true);
            });
        } else {
            return await this.rollSkillCheck(skillId, skl, options);
        }
    }

    /**
     * Roll a generic ability test.
     * 
     * @param {String} abilityId The ability id (e.g. "str")
     * @param {Object} options Options which configure how ability tests are rolled
     */
    async rollAbility(abilityId, options = {}) {
        const label = CONFIG.SFRPG.abilities[abilityId];
        const abl = this.data.data.abilities[abilityId];
        
        let parts = [];
        let data = this.getRollData();

        //Include ability check bonus only if it's not 0
        if(abl.abilityCheckBonus) {
            parts.push('@abilityCheckBonus');
            data.abilityCheckBonus = abl.abilityCheckBonus;
        }
        parts.push(`@abilities.${abilityId}.mod`);

        const rollContext = new RollContext();
        rollContext.addContext("main", this, data);
        rollContext.setMainContext("main");

        this.setupRollContexts(rollContext);

        return await DiceSFRPG.d20Roll({
            event: options.event,
            rollContext: rollContext,
            parts: parts,
            title:  `Ability Check - ${label}`,
            flavor: `Ability Check - ${label}`,
            speaker: ChatMessage.getSpeaker({ actor: this }),
            dialogOptions: {
                left: options.event ? options.event.clientX - 80 : null,
                top: options.event ? options.event.clientY - 80 : null
            }
        });
    }

    /**
     * Roll a save check
     * 
     * @param {String} saveId The save id (e.g. "will")
     * @param {Object} options Options which configure how saves are rolled
     */
    async rollSave(saveId, options = {}) {
        const label = CONFIG.SFRPG.saves[saveId];
        const save = this.data.data.attributes[saveId];

        let parts = [];
        let data = this.getRollData();

        parts.push(`@attributes.${saveId}.bonus`);
        
        const rollContext = new RollContext();
        rollContext.addContext("main", this, data);
        rollContext.setMainContext("main");

        this.setupRollContexts(rollContext);

        return await DiceSFRPG.d20Roll({
            event: options.event,
            rollContext: rollContext,
            parts: parts,
            title: `Save - ${label}`,
            flavor: `Save - ${label}`,
            speaker: ChatMessage.getSpeaker({ actor: this }),
            dialogOptions: {
                left: options.event ? options.event.clientX - 80 : null,
                top: options.event ? options.event.clientY - 80 : null
            }
        });
    }

    async rollSkillCheck(skillId, skill, options = {}) {
        let parts = [];
        let data = this.getRollData();

        parts.push(`@skills.${skillId}.mod`);
        
        const rollContext = new RollContext();
        rollContext.addContext("main", this, data);
        rollContext.setMainContext("main");

        this.setupRollContexts(rollContext);
        
        return await DiceSFRPG.d20Roll({
            event: options.event,
            rollContext: rollContext,
            parts: parts,
            title: `Skill Check - ${CONFIG.SFRPG.skills[skillId.substring(0, 3)]}`,
            flavor: `Skill Check - ${CONFIG.SFRPG.skills[skillId.substring(0, 3)]}`,
            speaker: ChatMessage.getSpeaker({ actor: this }),
            dialogOptions: {
                left: options.event ? options.event.clientX - 80 : null,
                top: options.event ? options.event.clientY - 80 : null
            }
        });
    }

    static async applyDamage(roll, multiplier) {
        let value = Math.floor(parseFloat(roll.find('.dice-total').text()) * multiplier);
        const promises = [];
        for (let t of canvas.tokens.controlled) {
            if (t.actor.data.type === "starship") {
                ui.notifications.warn("Cannot currently apply damage to starships using the context menu");
                continue;
            } else if (t.actor.data.type === "vehicle") {
                ui.notifications.warn("Cannot currently apply damage to vehicles using the context menu");
                continue;
            }

            let a = t.actor,
                hp = a.data.data.attributes.hp,
                sp = a.data.data.attributes.sp,
                tmp = parseInt(hp.temp) | 0,
                dt = value > 0 ? Math.min(tmp, value) : 0,
                tmpd = tmp - dt,
                // stamina doesn't get healed like hit points do, so skip it if we're appling 
                // healing instead of damage.
                spd = value > 0 ? Math.clamped(sp.value - (value - dt), 0, sp.max) : sp.value;

            dt = value > 0 ? value - Math.clamped((value - dt) - sp.value, 0, value) : 0;

            let hpd = Math.clamped(hp.value - (value - dt), 0, hp.max);

            promises.push(t.actor.update({
                "data.attributes.hp.temp": tmpd,
                "data.attributes.sp.value": spd,
                "data.attributes.hp.value": hpd
            }));
        }

        return Promise.all(promises);
    }

    /**
     * Cause this Actor to take a Short 10 minute Rest
     * During a Short Rest resources and limited item uses may be recovered
     * @param {boolean} dialog  Present a dialog window which allows for spending Resolve Points as part of the Short Rest
     * @param {boolean} chat    Summarize the results of the rest workflow as a chat message
     * @return {Promise}        A Promise which resolves once the short rest workflow has completed
     */
    async shortRest({ dialog = true, chat = true } = {}) {
        const data = this.data.data;

        // Ask user to confirm if they want to rest, and if they want to restore stamina points
        let sp = data.attributes.sp;
        let rp = data.attributes.rp;
        let canRestoreStaminaPoints = rp.value > 0 && sp.value < sp.max;

        let restoreStaminaPoints = false;

        if (dialog) {
            const restingResults = await ShortRestDialog.shortRestDialog({ actor: this, canRestoreStaminaPoints: canRestoreStaminaPoints });
            if (!restingResults.resting) return;
            restoreStaminaPoints = restingResults.restoreStaminaPoints;
        }
        
        let drp = 0;
        let dsp = 0;
        if (restoreStaminaPoints && canRestoreStaminaPoints) {
            drp = 1;
            let updatedRP = Math.max(rp.value - drp, 0);
            dsp = Math.min(sp.max - sp.value, sp.max);
            
            this.update({ "data.attributes.sp.value": sp.max, "data.attributes.rp.value": updatedRP });
        }

        // Restore resources that reset on short rests
        const updateData = {};
        for (let [k, r] of Object.entries(data.resources)) {
            if (r.max && r.sr) {
                updateData[`data.resources.${k}.value`] = r.max;
            }
        }

        await this.update(updateData);

        // Reset items that restore their uses on a short rest
        const items = this.items.filter(item => item.data.data.uses && (item.data.data.uses.per === "sr"));
        const updateItems = items.map(item => {
            return {
                "id": item.data.id,
                "data.uses.value": item.data.data.uses.max
            }
        });

        await this.updateEmbeddedEntity("OwnedItem", updateItems);

        // Notify chat what happened
        if (chat) {
            let msg = game.i18n.format("SFRPG.RestSChatMessage", { name: this.name });
            if (drp > 0) {
                msg = game.i18n.format("SFRPG.RestSChatMessageRestored", { name: this.name, spentRP: drp, regainedSP: dsp });
            }
            
            ChatMessage.create({
                user: game.user._id,
                speaker: { actor: this, alias: this.name },
                content: msg,
                type: CONST.CHAT_MESSAGE_TYPES.OTHER
            });
        }

        return {
            drp: drp,
            dsp: dsp,
            updateData: updateData,
            updateItems: updateItems
        }
    }

    /**
     * Cause this Actor to repair itself following drone repairing rules
     * During a drone repair, some amount of drone HP may be recovered.
     * @param {boolean} dialog  Present a dialog window which allows for utilizing the Repair Drone (Ex) feat while repairing.
     * @param {boolean} chat    Summarize the results of the repair workflow as a chat message
     * @return {Promise}        A Promise which resolves once the repair workflow has completed
     */
    async repairDrone({ dialog = true, chat = true } = {}) {
        const data = this.data.data;

        let hp = data.attributes.hp;
        if (hp.value >= hp.max) {
            let message = game.i18n.format("SFRPG.RepairDroneUnnecessary", { name: this.name });
            ui.notifications.info(message);
            return;
        }

        let improvedRepairFeat = false;
        if (dialog) {
            const dialogResults = await DroneRepairDialog.droneRepairDialog({ actor: this, improvedRepairFeat: improvedRepairFeat });
            if (!dialogResults.repairing) return;
            improvedRepairFeat = dialogResults.improvedRepairFeat;
        }
        
        let oldHP = hp.value;
        let maxRepairAmount = Math.floor(improvedRepairFeat ? hp.max * 0.25 : hp.max * 0.1);
        let newHP = Math.min(hp.max, hp.value + maxRepairAmount);
        let dhp = newHP - oldHP;

        const updateData = {};
        updateData["data.attributes.hp.value"] = newHP;
        await this.update(updateData);

        // Notify chat what happened
        if (chat) {
            let msg = game.i18n.format("SFRPG.RepairDroneChatMessage", { name: this.name, regainedHP: dhp });
            
            ChatMessage.create({
                user: game.user._id,
                speaker: { actor: this, alias: this.name },
                content: msg,
                type: CONST.CHAT_MESSAGE_TYPES.OTHER
            });
        }

        return {
            dhp: dhp,
            updateData: updateData
        };
    }

    async removeFromCrew() {
        await this.unsetFlag('sfrpg', 'crewMember');
    }

    async setCrewMemberRole(shipId, role) {
        return this.setFlag('sfrpg', 'crewMember', {
            shipId: shipId,
            role: role
        });
    }

    /**
     * Take a long nights rest, recovering HP, SP, RP, resources, and spell slots
     * @param {boolean} dialog  Present a confirmation dialog window whether or not to take a long rest
     * @param {boolean} chat    Summarize the results of the rest workflow as a chat message
     * @return {Promise}        A Promise which resolves once the long rest workflow has completed
     */
    async longRest({ dialog = true, chat = true } = {}) {
        const data = duplicate(this.data.data);
        const updateData = {};

        if (dialog) {
            try {
                await ShortRestDialog.longRestDialog(this);
            } catch (err) {
                return;
            }
        }

        // Recover HP, SP, and RP
        let dhp = data.attributes.hp.max === data.attributes.hp.value ? 0 :
            data.details.level.value > (data.attributes.hp.max - data.attributes.hp.value) ?
                data.attributes.hp.max - data.attributes.hp.value : data.details.level.value;
        let dsp = data.attributes.sp.max - data.attributes.sp.value;
        let drp = data.attributes.rp.max - data.attributes.rp.value;
        updateData['data.attributes.hp.value'] = Math.min(data.attributes.hp.value + data.details.level.value, data.attributes.hp.max);
        updateData['data.attributes.sp.value'] = data.attributes.sp.max;
        updateData['data.attributes.rp.value'] = data.attributes.rp.max;

        // Heal Ability damage
        for (let [abl, ability] of Object.entries(data.abilities)) {
            if (ability.damage && ability.damage > 0) {
                updateData[`data.abilities.${abl}.damage`] = --ability.damage;
            } 
        }

        for (let [k, r] of Object.entries(data.resources)) {
            if (r.max && (r.sr || r.lr)) {
                updateData[`data.resources.${k}.value`] = r.max;
            }
        }

        for (let [k, v] of Object.entries(data.spells)) {
            if (!v.max) continue;
            updateData[`data.spells.${k}.value`] = v.max;
        }

        const items = this.items.filter(i => i.data.data.uses && ["sr", "lr", "day"].includes(i.data.data.uses.per));
        const updateItems = items.map(item => {
            return {
                "_id": item.data._id,
                "data.uses.value": item.data.data.uses.max
            }
        });

        await this.update(updateData);
        await this.updateEmbeddedEntity("OwnedItem", updateItems);

        if (chat) {
            ChatMessage.create({
                user: game.user._id,
                speaker: { actor: this, alias: this.name },
                content: `${this.name} takes a night's rest and recovers ${dhp} Hit points, ${dsp} Stamina points, and ${drp} Resolve points.`
            });
        }

        return {
            dhp: dhp,
            dsp: dsp,
            drp: drp,
            updateData: updateData,
            updateItems: updateItems
        }
    }

    /** Crewed actor functionality */
    getCrewRoleForActor(actorId) {
        const acceptedActorTypes = ["starship", "vehicle"];
        if (!acceptedActorTypes.includes(this.data.type)) {
            console.log(`getCrewRoleForActor(${actorId}) called on an actor (${this.data._id}) of type ${this.data.type}, which is not supported!`);
            console.trace();
            return null;
        }

        if (!this.data?.data?.crew) {
            return null;
        }

        for (const [role, entry] of Object.entries(this.data.data.crew)) {
            if (entry?.actorIds?.includes(actorId)) {
                return role;
            }
        }
        return null;
    }

    getActorIdsForCrewRole(role) {
        const acceptedActorTypes = ["starship", "vehicle"];
        if (!acceptedActorTypes.includes(this.data.type)) {
            console.log(`getActorIdsForCrewRole(${role}) called on an actor (${this.data._id}) of type ${this.data.type}, which is not supported!`);
            console.trace();
            return null;
        }

        if (!this.data?.data?.crew) {
            return null;
        }

        if (!(role in this.data.data.crew)) {
            return null;
        }

        return duplicate(this.data.data.crew[role]);
    }

    setupRollContexts(rollContext, desiredSelectors = []) {
        if (this.data.type === "starship" && this.data.data.crew) {
            if (this.data.data.crew.captain?.actors?.length > 0) {
                rollContext.addContext("captain", this.data.data.crew.captain.actors[0]);
            }
    
            if (this.data.data.crew.pilot?.actors?.length > 0) {
                rollContext.addContext("pilot", this.data.data.crew.pilot.actors[0]);
            }
    
            const crewMates = ["gunner", "engineer", "chiefMate", "magicOfficer", "passenger", "scienceOfficer", "minorCrew", "openCrew"];
            const allCrewMates = ["minorCrew", "openCrew"];
            for (const crewType of crewMates) {
                let crewCount = 1;
                const crew = [];
                if (allCrewMates.includes(crewType)) {
                    for (const crewEntries of Object.values(this.data.data.crew)) {
                        const crewList = crewEntries.actors;
                        if (crewList && crewList.length > 0) {
                            for (const actor of crewList) {
                                const contextId = crewType + crewCount;
                                rollContext.addContext(contextId, actor);
                                crew.push(contextId);
                                crewCount += 1;
                            }
                        }
                    }
                } else {
                    const crewList = this.data.data.crew[crewType].actors;
                    if (crewList && crewList.length > 0) {
                        for (const actor of crewList) {
                            const contextId = crewType + crewCount;
                            rollContext.addContext(contextId, actor);
                            crew.push(contextId);
                            crewCount += 1;
                        }
                    }
                }
    
                if (desiredSelectors.includes(crewType)) {
                    rollContext.addSelector(crewType, crew);
                }
            }
        }
    }
}
