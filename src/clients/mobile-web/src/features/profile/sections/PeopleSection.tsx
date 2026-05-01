/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — People (team directory) tab section.
 *
 * Thin wrapper around PeopleDirectory. The 'people' tab is currently not
 * wired in the orchestrator (the team list lives inside IdentitySection in
 * the original layout); this file is kept so future re-wiring is a one-line
 * change instead of a re-import.
 */

import React from 'react';
import { Person } from '../../../types';
import PeopleDirectory from '../../people/components/PeopleDirectory';

interface PeopleSectionProps {
    people: Person[];
    onAddPerson: (person: Person) => void;
    onDeletePerson: (id: string) => void;
}

const PeopleSection: React.FC<PeopleSectionProps> = ({ people, onAddPerson, onDeletePerson }) => {
    return (
        <PeopleDirectory
            people={people}
            onAddPerson={onAddPerson}
            onDeletePerson={onDeletePerson}
        />
    );
};

export default PeopleSection;
