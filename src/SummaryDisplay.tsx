import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import { Summary } from "./types";

export interface SummaryDisplayProps {
  summary: Summary;
}

export default function SummaryDisplay({ summary }: SummaryDisplayProps) {
  return (
    <Grid container spacing={2}>
      {summary.map((item, index) => {
        if (item.type == "numeric") {
          return (
            <Grid>
              <Card key={index}>
                <CardContent>
                  <h2>{item.columnName}</h2>
                  <p>Not Null Count: {item.notNullCount ?? "N/A"}</p>
                  <p>Null Count: {item.nullCount ?? "N/A"}</p>
                  <p>Min: {item.min ?? "N/A"}</p>
                  <p>Q1: {item.q1 ?? "N/A"}</p>
                  <p>Median: {item.median ?? "N/A"}</p>
                  <p>Q3: {item.q3 ?? "N/A"}</p>
                  <p>Max: {item.max ?? "N/A"}</p>
                  <p>Mean: {item.mean ?? "N/A"}</p>
                </CardContent>
              </Card>
            </Grid>
          );
        }

        if (item.type == "categorical") {
          return (
            <Grid>
              <Card key={index}>
                <CardContent>
                  <h2>{item.columnName}</h2>
                  <p>Not Null Count: {item.notNullCount ?? "N/A"}</p>
                  <p>Null Count: {item.nullCount ?? "N/A"}</p>
                  <h3>Value Counts:</h3>
                  {item.valueCounts ? (
                    <ul>
                      {item.valueCounts.map((vc, vcIndex) => (
                        <li key={vcIndex}>
                          Value: {vc.value}, Count: {vc.count ?? "N/A"}, Prop:{" "}
                          {vc.prop ?? "N/A"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>N/A</p>
                  )}
                </CardContent>
              </Card>
            </Grid>
          );
        }

        if (item.type == "other") {
          return (
            <Grid>
              <Card key={index}>
                <CardContent>
                  <h2>{item.columnName}</h2>
                  <p>Column Name: {item.columnName}</p>
                  <p>Not Null Count: {item.notNullCount ?? "N/A"}</p>
                  <p>Null Count: {item.nullCount ?? "N/A"}</p>
                </CardContent>
              </Card>
            </Grid>
          );
        }

        return null;
      })}
    </Grid>
  );
}
