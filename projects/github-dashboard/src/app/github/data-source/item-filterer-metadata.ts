import {
  arrayContainsQuery,
  dateMatchesEquality,
  Filterer,
  FiltererContextProvider,
  FiltererMetadata,
  FiltererState,
  numberMatchesEquality,
  stateMatchesEquality,
  stringContainsQuery
} from '@crafted/data';
import {combineLatest, Observable} from 'rxjs';
import {map} from 'rxjs/operators';
import {Recommendation} from '../../repository/services/dao/config/recommendation';
import {Item} from '../app-types/item';
import {Label} from '../app-types/label';
import {createLabelsMap} from '../utility/create-labels-map';
import {tokenizeItem} from '../utility/tokenize-item';

export function getFiltererProvider(
    labels: Observable<Label[]>, recommendations: Observable<Recommendation[]>,
    getRecommendations: (item, recommendations: Recommendation[], labelsMap: Map<string, Label>) =>
        Recommendation[]): (initialState?: FiltererState) => Filterer<Item, MatcherContext> {
  return (initialState?: FiltererState) => {
    const contextProvider =
        createFiltererContextProvider(labels, recommendations, getRecommendations);
    const filterer =
        new Filterer({metadata: ItemsFilterMetadata, contextProvider, initialState, tokenizeItem});
    return filterer;
  };
}

interface MatcherContext {
  labelsMap: Map<string, Label>;
  getRecommendations: (item) => Recommendation[];
}

function createFiltererContextProvider(
    labels: Observable<Label[]>, recommendations: Observable<Recommendation[]>,
    getRecommendations: (item, recommendations: Recommendation[], labelsMap: Map<string, Label>) =>
        Recommendation[]): FiltererContextProvider<MatcherContext> {
  return combineLatest(recommendations, labels).pipe(map(results => {
    const labelsMap = createLabelsMap(results[1]);
    return {
      labelsMap,
      getRecommendations: (item) => getRecommendations(item, results[0], labelsMap)
    };
  }));
}

export const ItemsFilterMetadata = new Map<string, FiltererMetadata<Item, MatcherContext>>([

  /** InputQuery Filters */

  [
    'title', {
      label: 'Title',
      type: 'input',
      matcher: (item, filter) => stringContainsQuery(item.title, filter.input, filter.equality),
      autocomplete: items => items.map(issue => issue.title)
    }
  ],

  [
    'assignees', {
      label: 'Assignee',
      type: 'input',
      matcher: (item, filter) => arrayContainsQuery(item.assignees, filter.input, filter.equality),
      autocomplete: items => {
        const assigneesSet = new Set<string>();
        items.forEach(item => item.assignees.forEach(a => assigneesSet.add(a)));

        const assignees: string[] = [];
        assigneesSet.forEach(a => assignees.push(a));
        assignees.sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
        return assignees;
      }
    }
  ],

  [
    'body', {
      label: 'Body',
      type: 'input',
      matcher: (item, filter) => stringContainsQuery(item.body, filter.input, filter.equality),
      autocomplete: () => [],
    }
  ],

  [
    'labels', {
      label: 'Labels',
      type: 'input',
      matcher: (item, filter, context) => {
        const labelIds = item.labels.map(labelId => `${labelId}`);
        const labelNames = labelIds.map(l => {
          const label = context.labelsMap.get(l);

          if (!label) {
            return '';
          }

          return label.name;
        });
        return arrayContainsQuery(labelNames, filter.input, filter.equality);
      },
      autocomplete: (_items: Item[], c: MatcherContext) => {
        const labelNames: string[] = [];
        c.labelsMap.forEach(label => labelNames.push(label.name));

        return labelNames.sort();
      }
    }
  ],

  /** NumberQuery Filters */

  [
    'commentCount', {
      label: 'Comment Count',
      type: 'number',
      matcher: (item, filter) => numberMatchesEquality(item.comments, filter.value, filter.equality)
    }
  ],
  [
    'reactionCount', {
      label: 'Reaction Count',
      type: 'number',
      matcher: (item, filter) =>
          numberMatchesEquality(item.reactions['+1'], filter.value, filter.equality)
    }
  ],

  [
    'days-since-created', {
      label: 'Days Since Created',
      type: 'number',
      matcher: (item, filter) => {
        const dayInMs = 1000 * 60 * 60 * 24;
        const nowMs = new Date().getTime();
        const createdDateMs = new Date(item.created).getTime();
        const days = Math.round(Math.abs(nowMs - createdDateMs) / dayInMs);

        return numberMatchesEquality(days, filter.value, filter.equality);
      }
    }
  ],

  [
    'days-since-updated', {
      label: 'Days Since Updated',
      type: 'number',
      matcher: (item, filter) => {
        const dayInMs = 1000 * 60 * 60 * 24;
        const nowMs = new Date().getTime();
        const createdDateMs = new Date(item.updated).getTime();
        const days = Math.round(Math.abs(nowMs - createdDateMs) / dayInMs);

        return numberMatchesEquality(days, filter.value, filter.equality);
      }
    }
  ],

  [
    'days-open', {
      label: 'Days Open',
      type: 'number',
      matcher: (item, filter) => {
        const dayInMs = 1000 * 60 * 60 * 24;

        // If item has not yet been closed, use current time
        const closedDateMs = new Date(item.closed).getTime() || new Date().getTime();
        const createdDateMs = new Date(item.created).getTime();
        const days = Math.round(Math.abs(closedDateMs - createdDateMs) / dayInMs);

        return numberMatchesEquality(days, filter.value, filter.equality);
      }
    }
  ],

  /** DateQuery Filters */

  [
    'created', {
      label: 'Date Created',
      type: 'date',
      matcher: (item, filter) => {
        return dateMatchesEquality(item.created, filter.date, filter.equality);
      }
    }
  ],

  /** StateQuery */

  [
    'state', {
      label: 'State',
      type: 'state',
      states: ['open', 'closed'],
      matcher: (item, filter) => {
        const values = new Map<string, boolean>([
          ['open', item.state === 'open'],
          ['closed', item.state === 'closed'],
        ]);
        return stateMatchesEquality(values.get(filter.state)!, filter.state, filter.equality);
      },
    }
  ],

  [
    'recommendation', {
      label: 'Recommendation',
      type: 'state',
      states: ['empty', 'at least one warning', 'at least one suggestion'],
      matcher: (item, filter, context) => {
        const recommendations = context.getRecommendations(item);
        const values = new Map<string, boolean>([
          ['empty', !recommendations.length],
          ['at least one warning', recommendations.some(r => r.type === 'warning')],
          ['at least one suggestion', recommendations.some(r => r.type === 'suggestion')],
        ]);
        return stateMatchesEquality(values.get(filter.state)!, filter.state, filter.equality);
      },
    }
  ],
]);
