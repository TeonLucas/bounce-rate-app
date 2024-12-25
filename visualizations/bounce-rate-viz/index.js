import React from 'react';
import PropTypes from 'prop-types';
import {Card, CardBody, HeadingText, LineChart, NrqlQuery, PlatformStateContext} from 'nr1';

export default class BounceRateVisualization extends React.Component {
    // Custom props you wish to be configurable in the UI must also be defined in
    // the nr1.json file for the visualization. See docs for more details.
    static propTypes = {
        /**
         * Account Id against which the query needs to be executed
         */
        accountId: PropTypes.number,
        /**
         * Choose how often to query (to not exceed 5000 facets)
         */
        queryInterval: PropTypes.number,
    }

    constructor(props) {
        super(props);
        this.state = {
            chartData: [],
            interval: 60000,
            intervalId: null,
            selectedItem: null,
            maxRate: null,
            maxInterval: null,
        };
        this.initial = 5;
        this.run = () => this.runQueries();
        this.set = (context) => this.setTimeInterval(context);
        this.pallette = ["#e60049", "#0bb4ff", "#50e991", "#e6d800", "#9b19f5", "#ffa300", "#dc0ab4", "#b3d4ff", "#00bfa0", "#b30000", "#7c1158", "#4421af", "#1a53ff", "#8be04e", "#ebdc78"];
    }

    /**
     * Call runQueries when time-picker changes
     */
    componentDidMount() {
        PlatformStateContext.subscribe(this.set);
    }

    /**
     * Run Nrql query to recommend largest interval
     */
    recommendConfig() {
        const {accountId} = this.props;
        const query = 'FROM (FROM BrowserInteraction SELECT uniqueCount(session) AS sessions FACET hourOf(timestamp), appName LIMIT MAX) SELECT max(sessions) AS sessionsPerHour SINCE 1 week ago'
        if (!accountId) {
            console.log('recommendConfig: AccountId not configured');
            return
        }
        const accountIds = [accountId];
        NrqlQuery.query({query, accountIds}).then((results) => {
            const maxRate = results.data[0].data[0].sessionsPerHour;
            const intervals = 5000 / maxRate;
            let maxInterval = "1 minute";
            if (intervals > 24) {
                maxInterval = "1 day"
            } else if (intervals > 12) {
                maxInterval = "12 hours"
            } else if (intervals > 6) {
                maxInterval = "6 hours"
            } else if (intervals > 4) {
                maxInterval = "4 hours"
            } else if (intervals > 1) {
                maxInterval = "1 hour"
            } else if (maxRate < 10000) {
                maxInterval = "30 minutes"
            } else if (maxRate < 20000) {
                maxInterval = "15 minutes"
            } else if (maxRate < 30000) {
                maxInterval = "10 minutes"
            }
            this.setState({maxRate, maxInterval});
        });
    }

    /**
     * Set the time range and refresh interval
     */
    setTimeInterval(context) {
        // Skip initial calls to avoid repeating
        if (this.initial) {
            //console.log('Skipping setTimeInterval initial calls');
            this.initial--;
            return
        }
        // Calculate duration
        let duration;
        if (context.timeRange) {
            if (context.timeRange.duration) {
                if (this.timeRange && context.timeRange.duration === this.timeRange.duration) {
                    // nothing changed, exit
                    return;
                }
                duration = context.timeRange.duration;
            } else if (context.timeRange.begin_time && context.timeRange.end_time) {
                if (this.timeRange && context.timeRange.begin_time === this.timeRange.begin_time &&
                    context.timeRange.end_time === this.timeRange.end_time) {
                    // nothing changed, exit
                    return;
                }
                duration = context.timeRange.end_time - context.timeRange.begin_time;
            } else {
                duration = 3600000;
            }
            this.timeRange = context.timeRange;
        } else {
            this.timeRange = {};
            duration = 3600000;
        }
        // Set refresh interval to 1/60 of duration, or at least 1 minute
        let interval = Math.round(duration / 60);
        if (interval < 60000) {
            interval = 60000;
        }
        // Update refresh as needed
        if (!this.intervalId) {
            this.intervalId = setInterval(this.run, interval);
            this.interval = interval;
        } else if (this.interval !== interval) {
            clearInterval(this.state.intervalId);
            this.intervalId = setInterval(this.run, interval);
            this.interval = interval;
        }
        // Run queries
        this.runQueries();
    }

    /**
     * Store Nrql results, and set state with results in array position
     */
    storeResults(results, i, j, x) {
        const {chartData} = this.state;
        const y = results.data[0].data[0].bounce;
        chartData[i].data[j] = {x, y};
        this.setState({chartData});
    }

    /**
     * Run Nrql queries, append together, and set state with results
     */
    runQueries() {
        const {accountId, queryInterval} = this.props;
        const nrqlApps = 'FROM BrowserInteraction SELECT uniques(appName)';
        const nrqlBounce1 = "FROM (FROM BrowserInteraction SELECT count(browserInteractionId) AS usrInteractionCount WHERE appName = '";
        const nrqlBounce2 = "' FACET session LIMIT MAX) SELECT percentage(count(session), WHERE usrInteractionCount = 1) AS bounce";
        if (!accountId) {
            console.log('runQueries: AccountId not configured');
            return
        }
        const accountIds = [accountId];
        if (!queryInterval) {
            console.log('runQueries: Query Interval not configured');
            return
        }

        // Calculate time range
        let duration, begin_time, end_time;
        const now = Date.now();
        if (this.timeRange.duration) {
            duration = this.timeRange.duration;
            begin_time = now - this.timeRange.duration;
            end_time = now;
        } else if (this.timeRange.begin_time && this.timeRange.end_time) {
            duration = this.timeRange.end_time - this.timeRange.begin_time;
            begin_time = this.timeRange.begin_time;
            end_time = this.timeRange.end_time;
        } else {
            // No duration means default to 1 day
            // TODO: Make 1 hour
            duration = 3600000 * 24;
            begin_time = now - duration;
            end_time = now;
        }
        const interval = queryInterval * 60000;
        let queries = 1;
        if (duration > interval) {
            queries = duration / interval;
            if (duration % interval > 1) {
                queries++;
            }
        }
        const step = duration / queries;
        console.log('Queries to run per app:', queries);

        // Get list of apps
        console.log('Getting list of apps');
        const range = ' SINCE ' + begin_time.toString() + ' UNTIL ' + end_time.toString();
        const query = nrqlApps + range;
        NrqlQuery.query({query, accountIds}).then((results) => {
            const apps = results.data[0].data;
            // Populate chart data array for each app
            console.log('Getting session rates for', apps.length, 'apps');
            let chartData = [];
            // Initialize chart data array
            let index = 0;
            for (const app of apps) {
                chartData.push({metadata: {
                    id: 'app-' + (index+1).toString(),
                    name: app.appName,
                    viz: 'main',
                    color: this.pallette[index],
                    units_data: {x: 'TIMESTAMP'},
                }, data: new Array(queries)});
                index++;
            }
            this.state.chartData = chartData;  // don't need to render here
            // Query data for each app by interval
            index = 0;
            for (const app of apps) {
                console.log('Query app ' + app.appName);
                for (let j = 0; j < queries; j++) {
                    let start = begin_time + Math.round(step * j);
                    let end;
                    if (j === queries - 1) {
                        end = end_time;
                    } else {
                        end = begin_time + Math.round(step * (j + 1));
                    }
                    const x = Math.round((start + end) / 2);
                    const i = index;
                    const query = nrqlBounce1 + app.appName + nrqlBounce2 + ' SINCE ' + start.toString() + ' UNTIL ' + end.toString();
                    NrqlQuery.query({query, accountIds}).then(results => this.storeResults(results, i, j, x));
                }
                index++;
            }
        });
    }

    render() {
        const {accountId, queryInterval} = this.props;
        const {chartData, maxRate, maxInterval} = this.state;
        if (!accountId) {
            return <EmptyState message="Please first select an Account Id"/>;
        }
        if (!queryInterval) {
            if (!maxRate) {
                this.recommendConfig();
            }
            let message = "Please select a Query Interval";
            return <EmptyState message={message} maxRate={maxRate} maxInterval={maxInterval}/>;
        }
        return <LineChart data={chartData} fullHeight fullWidth/>;
    }
}

const EmptyState = (props) => (
    <Card className="EmptyState">
        <CardBody className="EmptyState-cardBody">
            <HeadingText
                spacingType={[HeadingText.SPACING_TYPE.LARGE]}
                type={HeadingText.TYPE.HEADING_3}
            >
                {props.message}:
            </HeadingText>
            <p>
                Max sessions per hour is {props.maxRate ? props.maxRate : "not yet calculated..."}<br/>
                Recommended query interval: {props.maxInterval ? props.maxInterval : "not yet calculated..."}<br/>
                You cannot go less frequent, based on past 1 week data.<br/>
                Weeks may vary seasonally, so more frequent may be needed.
            </p>
        </CardBody>
    </Card>
);

const ErrorState = (props) => (
    <Card className="ErrorState">
        <CardBody className="ErrorState-cardBody">
            <HeadingText
                className="ErrorState-headingText"
                spacingType={[HeadingText.SPACING_TYPE.LARGE]}
                type={HeadingText.TYPE.HEADING_3}
            >
                Oops! Something went wrong.<br/><br/>
                {props.message}
            </HeadingText>
        </CardBody>
    </Card>
);
